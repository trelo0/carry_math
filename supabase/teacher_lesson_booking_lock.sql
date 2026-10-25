-- Бронирование individual без гонки: advisory lock + проверка пересечения в одной транзакции.
-- GiST на timestamptz+interval на PG17 может быть недоступен (immutable); этот путь работает на remote.

create or replace function public.teacher_insert_individual_lesson(
  p_teacher_id bigint,
  p_starts_at timestamptz,
  p_duration_minutes int,
  p_topic text,
  p_participant_name text,
  p_schedule_student_id bigint,
  p_lesson_plan text
)
returns bigint
language plpgsql
security invoker
as $$
declare
  new_id bigint;
  p_end timestamptz;
begin
  if p_duration_minutes is null or p_duration_minutes < 1 then
    raise exception 'invalid duration';
  end if;

  perform pg_advisory_xact_lock(p_teacher_id);

  p_end := p_starts_at + (p_duration_minutes * interval '1 minute');

  if exists (
    select 1
    from public.scheduled_lessons sl
    where sl.teacher_telegram_id = p_teacher_id
      and sl.status = 'scheduled'
      and sl.kind = 'individual'
      and sl.starts_at < p_end
      and sl.starts_at + (sl.duration_minutes * interval '1 minute') > p_starts_at
  ) then
    raise exception 'На это время уже назначено занятие' using errcode = '23505';
  end if;

  insert into public.scheduled_lessons (
    telegram_id,
    kind,
    teacher_telegram_id,
    starts_at,
    duration_minutes,
    topic,
    status,
    package_id,
    lesson_plan,
    participant_name,
    schedule_student_id
  )
  values (
    null,
    'individual',
    p_teacher_id,
    p_starts_at,
    p_duration_minutes,
    p_topic,
    'scheduled',
    null,
    p_lesson_plan,
    p_participant_name,
    p_schedule_student_id
  )
  returning id into new_id;

  return new_id;
end;
$$;
