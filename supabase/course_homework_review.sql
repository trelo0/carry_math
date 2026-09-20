-- Комментарий куратора при проверке ДЗ (отдельно от submission_note ученика).
alter table public.course_lesson_student_progress
  add column if not exists review_note text;
