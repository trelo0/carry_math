-- Расширение staff_dm_topics: роль curator (топики куратор ↔ ученик).
alter table public.staff_dm_topics
  drop constraint if exists staff_dm_topics_staff_role_check;

alter table public.staff_dm_topics
  add constraint staff_dm_topics_staff_role_check
  check (staff_role in ('check', 'admin', 'curator'));
