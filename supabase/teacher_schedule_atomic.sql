-- Атомарные операции расписания (транзакция внутри функции).
-- archived_at для schedule_students (если ещё нет).

alter table public.schedule_students
  add column if not exists archived_at timestamptz;

create index if not exists schedule_students_teacher_active_idx
  on public.schedule_students (teacher_telegram_id, name)
  where archived_at is null;

-- GiST-исключение пересечений: см. scheduled_lessons_teacher_overlap.sql (отдельно; на PG17 нужна immutable-формула).

create or replace function public.teacher_apply_day_schedule(
  p_teacher_id bigint,
  p_date date,
  p_mode text,
  p_start time,
  p_end time,
  p_note text,
  p_moves jsonb
)
returns void
language plpgsql
security invoker
as $$
declare
  m jsonb;
  lid bigint;
  updated_count int;
begin
  if p_moves is null then
    p_moves := '[]'::jsonb;
  end if;

  for m in select * from jsonb_array_elements(p_moves)
  loop
    lid := (m->>'lesson_id')::bigint;
    update public.scheduled_lessons
    set
      starts_at = (m->>'starts_at')::timestamptz,
      duration_minutes = coalesce((m->>'duration_minutes')::int, duration_minutes),
      updated_at = now()
    where id = lid
      and teacher_telegram_id = p_teacher_id
      and status = 'scheduled';
    get diagnostics updated_count = row_count;
    if updated_count <> 1 then
      raise exception 'lesson % not found or not scheduled', lid;
    end if;
  end loop;

  if p_mode = 'off' then
    delete from public.teacher_day_overrides
    where teacher_telegram_id = p_teacher_id and override_date = p_date;
    insert into public.teacher_blocked_dates (teacher_telegram_id, blocked_date, note)
    values (p_teacher_id, p_date, nullif(trim(p_note), ''))
    on conflict (teacher_telegram_id, blocked_date)
    do update set note = excluded.note;
  elsif p_mode = 'work' then
    delete from public.teacher_blocked_dates
    where teacher_telegram_id = p_teacher_id and blocked_date = p_date;
    insert into public.teacher_day_overrides (
      teacher_telegram_id,
      override_date,
      start_time,
      end_time
    )
    values (p_teacher_id, p_date, p_start, p_end)
    on conflict (teacher_telegram_id, override_date)
    do update set start_time = excluded.start_time, end_time = excluded.end_time;
  else
    raise exception 'invalid mode %', p_mode;
  end if;
end;
$$;

create or replace function public.teacher_apply_weekly_schedule(
  p_teacher_id bigint,
  p_weekly jsonb,
  p_moves jsonb
)
returns void
language plpgsql
security invoker
as $$
declare
  m jsonb;
  s jsonb;
  lid bigint;
  updated_count int;
begin
  if p_moves is null then
    p_moves := '[]'::jsonb;
  end if;
  if p_weekly is null then
    p_weekly := '[]'::jsonb;
  end if;

  for m in select * from jsonb_array_elements(p_moves)
  loop
    lid := (m->>'lesson_id')::bigint;
    update public.scheduled_lessons
    set
      starts_at = (m->>'starts_at')::timestamptz,
      duration_minutes = coalesce((m->>'duration_minutes')::int, duration_minutes),
      updated_at = now()
    where id = lid
      and teacher_telegram_id = p_teacher_id
      and status = 'scheduled';
    get diagnostics updated_count = row_count;
    if updated_count <> 1 then
      raise exception 'lesson % not found or not scheduled', lid;
    end if;
  end loop;

  delete from public.teacher_availability where teacher_telegram_id = p_teacher_id;

  for s in select * from jsonb_array_elements(p_weekly)
  loop
    insert into public.teacher_availability (
      teacher_telegram_id,
      day_of_week,
      start_time,
      end_time,
      kind
    )
    values (
      p_teacher_id,
      (s->>'day_of_week')::smallint,
      (s->>'start_time')::time,
      (s->>'end_time')::time,
      coalesce(s->>'kind', 'both')
    );
  end loop;
end;
$$;
