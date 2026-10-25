alter table public.scheduled_lessons
  add column if not exists participant_name text;
