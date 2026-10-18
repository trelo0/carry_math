-- Колонки отправки ДЗ (если не применялся блок из course_catalog.sql).
alter table public.course_lesson_student_progress
  add column if not exists homework_submitted_at timestamptz;

alter table public.course_lesson_student_progress
  add column if not exists submission_note text;

alter table public.course_lesson_student_progress
  add column if not exists submission_file_url text;
