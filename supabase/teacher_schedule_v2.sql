-- Расписание v2: причина отмены занятия.

alter table public.scheduled_lessons
  add column if not exists cancel_reason text;
