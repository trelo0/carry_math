-- Сценарии покупки курса: выбор формата обучения
-- Порядок: course_catalog.sql → course_sanity_keys.sql → этот файл

-- Добавляем поля в course_enrollments для хранения сценария и стартового состояния
alter table public.course_enrollments
  add column if not exists purchase_scenario text
  check (purchase_scenario in ('start_from_beginning', 'join_current'));

alter table public.course_enrollments
  add column if not exists start_module_id bigint
  references public.course_modules (id) on delete set null;

alter table public.course_enrollments
  add column if not exists start_lesson_id bigint
  references public.course_lessons (id) on delete set null;

-- Индексы для быстрого поиска по сценариям
create index if not exists course_enrollments_scenario_idx
  on public.course_enrollments (purchase_scenario);

create index if not exists course_enrollments_start_module_idx
  on public.course_enrollments (start_module_id);

create index if not exists course_enrollments_start_lesson_idx
  on public.course_enrollments (start_lesson_id);
