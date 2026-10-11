-- Процент просмотра видео и открытые материалы занятия (прогресс урока 60% + 40% ДЗ).

alter table public.course_lesson_student_progress
  add column if not exists watch_percent smallint not null default 0
    check (watch_percent >= 0 and watch_percent <= 100);

alter table public.course_lesson_student_progress
  add column if not exists materials_opened jsonb not null default '[]'::jsonb;

comment on column public.course_lesson_student_progress.watch_percent is
  'Максимальный % просмотра записи/эфира (YouTube IFrame API или native video).';

comment on column public.course_lesson_student_progress.materials_opened is
  'Ключи открытых файлов материалов/ДЗ (url или title), jsonb string[].';
