-- Изоляция прогресса/доступа по course_id (мультикурс).
-- Порядок: course_sanity_keys.sql → этот файл.

alter table public.course_lesson_student_progress
  add column if not exists course_id bigint references public.courses (id) on delete restrict;

alter table public.course_lesson_access
  add column if not exists course_id bigint references public.courses (id) on delete restrict;

create index if not exists course_lesson_student_progress_course_idx
  on public.course_lesson_student_progress (telegram_id, course_id);

create index if not exists course_lesson_access_course_idx
  on public.course_lesson_access (telegram_id, course_id);

-- Backfill progress: единственное активное зачисление на telegram_id + sanity урок в каталоге курса
-- (повторный запуск безопасен для уже заполненных строк).
update public.course_lesson_student_progress p
set course_id = sub.course_id
from (
  select distinct on (p2.id)
    p2.id as progress_id,
    ce.course_id
  from public.course_lesson_student_progress p2
  join public.course_enrollments ce
    on ce.telegram_id = p2.telegram_id and ce.status = 'active'
  join public.courses c on c.id = ce.course_id
  where p2.course_id is null
    and p2.sanity_lesson_id is not null
  order by p2.id, ce.started_at desc
) sub
where p.id = sub.progress_id
  and p.course_id is null;

update public.course_lesson_access a
set course_id = sub.course_id
from (
  select distinct on (a2.id)
    a2.id as access_id,
    ce.course_id
  from public.course_lesson_access a2
  join public.course_enrollments ce
    on ce.telegram_id = a2.telegram_id and ce.status = 'active'
  where a2.course_id is null
    and a2.sanity_lesson_id is not null
  order by a2.id, ce.started_at desc
) sub
where a.id = sub.access_id
  and a.course_id is null;

drop index if exists public.course_lesson_student_progress_sanity_idx;
drop index if exists public.course_lesson_access_sanity_idx;

create unique index if not exists course_lesson_student_progress_course_sanity_idx
  on public.course_lesson_student_progress (telegram_id, course_id, sanity_lesson_id)
  where sanity_lesson_id is not null and course_id is not null;

create unique index if not exists course_lesson_access_course_sanity_idx
  on public.course_lesson_access (telegram_id, course_id, sanity_lesson_id)
  where sanity_lesson_id is not null and course_id is not null;
