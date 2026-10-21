-- Backfill course_id на legacy course-пакетах (один district slug на null).
-- Запускать после course_catalog.sql и когда известны slug курсов.

-- Пример: привязать null course_id к основному курсу по slug (замените slug при необходимости).
update public.lesson_packages lp
set course_id = c.id
from public.courses c
where lp.product = 'course'
  and lp.course_id is null
  and c.slug = 'district-course';

-- События ДЗ: проставить course_id из progress где возможно
update public.course_homework_submission_events e
set course_id = p.course_id
from public.course_lesson_student_progress p
where e.course_id is null
  and e.telegram_id = p.telegram_id
  and e.sanity_lesson_id = p.sanity_lesson_id
  and p.course_id is not null;
