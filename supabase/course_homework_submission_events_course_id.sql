-- course_id на событиях сдачи ДЗ (мультикурс).
alter table public.course_homework_submission_events
  add column if not exists course_id bigint references public.courses (id) on delete restrict;

create index if not exists course_homework_submission_events_course_idx
  on public.course_homework_submission_events (telegram_id, course_id, sanity_lesson_id);

-- См. также lesson_packages_course_id_backfill.sql (UPDATE events из progress).
