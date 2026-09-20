-- Связь Sanity ↔ Supabase для состояния ученика (контент уроков — только в Sanity).
-- Порядок: course_catalog.sql → этот файл.

alter table public.courses
  add column if not exists sanity_id text;

create unique index if not exists courses_sanity_id_idx
  on public.courses (sanity_id)
  where sanity_id is not null;

-- Прогресс и доступ по stable Sanity document id
alter table public.course_lesson_student_progress
  add column if not exists sanity_lesson_id text;

alter table public.course_lesson_access
  add column if not exists sanity_lesson_id text;

alter table public.course_life_events
  add column if not exists sanity_lesson_id text;

alter table public.package_lesson_grants
  add column if not exists sanity_lesson_id text;

-- Nullable legacy FK (миграция с Supabase-каталога)
alter table public.course_lesson_student_progress
  alter column course_lesson_id drop not null;

alter table public.course_lesson_access
  alter column course_lesson_id drop not null;

alter table public.package_lesson_grants
  alter column course_lesson_id drop not null;

create unique index if not exists course_lesson_student_progress_sanity_idx
  on public.course_lesson_student_progress (telegram_id, sanity_lesson_id)
  where sanity_lesson_id is not null;

create unique index if not exists course_lesson_access_sanity_idx
  on public.course_lesson_access (telegram_id, sanity_lesson_id)
  where sanity_lesson_id is not null;

create unique index if not exists package_lesson_grants_sanity_idx
  on public.package_lesson_grants (package_id, sanity_lesson_id)
  where sanity_lesson_id is not null;

create index if not exists course_lesson_student_progress_sanity_lesson_idx
  on public.course_lesson_student_progress (sanity_lesson_id);

create index if not exists course_lesson_access_sanity_lesson_idx
  on public.course_lesson_access (sanity_lesson_id);

create unique index if not exists course_life_events_homework_deduct_idx
  on public.course_life_events (telegram_id, sanity_lesson_id)
  where sanity_lesson_id is not null and delta = -1;
