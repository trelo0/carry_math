-- Контекст курса в переписке check/curator ↔ ученик.
-- После staff_student_messages.sql

alter table public.staff_student_messages
  add column if not exists course_id bigint references public.courses (id) on delete set null;

create index if not exists staff_student_messages_course_idx
  on public.staff_student_messages (staff_telegram_id, staff_role, course_id, created_at desc);
