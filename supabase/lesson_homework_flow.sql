-- Домашние задания ind/group: инструкции, сдача учеником, проверка преподавателем.

alter table public.homework_assignments
  add column if not exists instruction_text text,
  add column if not exists due_at timestamptz,
  add column if not exists teacher_comment text,
  add column if not exists submission_text text,
  add column if not exists submission_files jsonb not null default '[]'::jsonb,
  add column if not exists submitted_at timestamptz;

alter table public.homework_assignments
  drop constraint if exists homework_assignments_review_status_check;

alter table public.homework_assignments
  add constraint homework_assignments_review_status_check
  check (review_status in ('pending', 'submitted', 'reviewing', 'done', 'revision'));
