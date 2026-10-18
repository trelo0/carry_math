-- Роль check в переписке staff ↔ ученик (без изменений бота/UI).
alter table public.staff_student_messages
  drop constraint if exists staff_student_messages_staff_role_check;

alter table public.staff_student_messages
  add constraint staff_student_messages_staff_role_check
  check (staff_role in ('teacher', 'curator', 'check'));
