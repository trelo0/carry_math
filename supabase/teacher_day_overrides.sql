-- Рабочее время преподавателя на конкретную дату (поверх недельного шаблона teacher_availability).
-- Выходной день хранится в teacher_blocked_dates; здесь — только изменённые часы.

create table if not exists public.teacher_day_overrides (
  id bigserial primary key,
  teacher_telegram_id bigint not null,
  override_date date not null,
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (teacher_telegram_id, override_date)
);

create index if not exists teacher_day_overrides_teacher_idx
  on public.teacher_day_overrides (teacher_telegram_id, override_date);

alter table public.teacher_day_overrides enable row level security;
