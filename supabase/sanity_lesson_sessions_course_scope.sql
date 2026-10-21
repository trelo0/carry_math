-- Эфиры по паре (course_id, sanity_lesson_id) — мультикурс.
alter table public.sanity_lesson_sessions
  add column if not exists course_id bigint references public.courses (id) on delete restrict;

create index if not exists sanity_lesson_sessions_course_idx
  on public.sanity_lesson_sessions (course_id);

-- Backfill из access (первый course_id на lesson id)
update public.sanity_lesson_sessions s
set course_id = sub.course_id
from (
  select distinct on (a.sanity_lesson_id)
    a.sanity_lesson_id,
    a.course_id
  from public.course_lesson_access a
  where a.course_id is not null
    and a.sanity_lesson_id is not null
  order by a.sanity_lesson_id, a.granted_at desc nulls last
) sub
where s.sanity_lesson_id = sub.sanity_lesson_id
  and s.course_id is null;

alter table public.sanity_lesson_sessions
  drop constraint if exists sanity_lesson_sessions_sanity_lesson_id_key;

drop index if exists public.sanity_lesson_sessions_sanity_lesson_id_key;

create unique index if not exists sanity_lesson_sessions_course_lesson_idx
  on public.sanity_lesson_sessions (course_id, sanity_lesson_id)
  where course_id is not null and sanity_lesson_id is not null;
