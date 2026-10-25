-- Мягкая архивация учеников расписания (без удаления истории занятий).
alter table public.schedule_students
  add column if not exists archived_at timestamptz;

create index if not exists schedule_students_teacher_active_idx
  on public.schedule_students (teacher_telegram_id, name)
  where archived_at is null;
