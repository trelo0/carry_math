-- Роль проверяющего ДЗ на курсе (course_staff_assignments.role = 'check').
-- Выполнить после course_staff_multicourse.sql.

alter table public.course_staff_assignments
  drop constraint if exists course_staff_assignments_role_check;

alter table public.course_staff_assignments
  add constraint course_staff_assignments_role_check
  check (role in ('teacher', 'curator', 'check'));

-- reviewer_role — колонка в homework_assignments (см. homework_review_meta.sql), не в progress.
alter table public.homework_assignments
  add column if not exists reviewed_by_telegram_id bigint,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewer_role text;

alter table public.homework_assignments
  drop constraint if exists homework_assignments_reviewer_role_check;

alter table public.homework_assignments
  add constraint homework_assignments_reviewer_role_check
  check (
    reviewer_role is null
    or reviewer_role in ('teacher', 'admin', 'curator', 'check')
  );

-- Мета проверки ДЗ курса (District progress, не homework_assignments).
alter table public.course_lesson_student_progress
  add column if not exists reviewed_by_telegram_id bigint,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewer_role text;

alter table public.course_lesson_student_progress
  drop constraint if exists course_lesson_student_progress_reviewer_role_check;

alter table public.course_lesson_student_progress
  add constraint course_lesson_student_progress_reviewer_role_check
  check (
    reviewer_role is null
    or reviewer_role in ('teacher', 'admin', 'curator', 'check')
  );
