-- Мультикурс: штат курса (кто ведёт / кто проверяет ДЗ) и привязка mentor_assignments к course_id.
-- Выполнить в Supabase SQL Editor после education.sql.

create table if not exists public.course_staff_assignments (
  id bigint generated always as identity primary key,
  course_id bigint not null references public.courses (id) on delete cascade,
  staff_telegram_id bigint not null references public.bot_members (telegram_id) on delete cascade,
  role text not null check (role in ('teacher', 'curator')),
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists course_staff_assignments_pair_uidx
  on public.course_staff_assignments (course_id, staff_telegram_id, role);

create index if not exists course_staff_assignments_staff_idx
  on public.course_staff_assignments (staff_telegram_id, status);

create index if not exists course_staff_assignments_course_idx
  on public.course_staff_assignments (course_id, role, status);

alter table public.course_staff_assignments enable row level security;

alter table public.mentor_assignments
  add column if not exists course_id bigint references public.courses (id) on delete cascade;

create index if not exists mentor_assignments_course_idx
  on public.mentor_assignments (course_id, kind, status)
  where course_id is not null;

-- Один активный наставник каждого kind на курс (course_id задан).
create unique index if not exists mentor_assignments_student_course_kind_active_idx
  on public.mentor_assignments (telegram_id, kind, course_id)
  where course_id is not null and status = 'active';

-- Один и тот же куратор на двух курсах у одного ученика (разный course_id).
drop index if exists public.mentor_assignments_unique_idx;
create unique index mentor_assignments_unique_idx
  on public.mentor_assignments (telegram_id, kind, mentor_telegram_id, coalesce(course_id, 0));
