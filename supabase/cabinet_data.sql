-- Выполнить в Supabase: Dashboard → SQL Editor → New query → Run.
-- Данные личного кабинета (занятия, пакеты, прогресс курса, профиль).
--
-- ПОРЯДОК (каждый файл — отдельный Run, если таблицы ещё нет):
--   1. supabase/bot_roles.sql          → bot_members
--   2. supabase/telegram_auth.sql      → telegram_links
--   3. supabase/user_accesses.sql      → user_accesses
--   4. supabase/education.sql          → courses, "groups", group_members, …
--   5. supabase/cabinet_data.sql
--   6. supabase/course_catalog.sql   → каталог курса, access, progress, lives
--
-- Ошибка relation "groups" does not exist → не выполнен education.sql (шаг 4).
--
-- RLS: политик нет, читает/пишет только service_role.

-- ---------------------------------------------------------------------------
-- 1. Профиль ученика в кабинете (настройки)
-- ---------------------------------------------------------------------------
create table if not exists public.student_profiles (
  telegram_id bigint primary key
    references public.bot_members (telegram_id) on delete cascade,
  display_name text,
  school_class text,
  goal text,
  result_type text check (result_type in ('ct', 'grade')),
  result_value smallint,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Купленные пакеты (курс / индивидуальные / групповые)
--    remaining_lessons — сколько занятий осталось в пакете.
-- ---------------------------------------------------------------------------
create table if not exists public.lesson_packages (
  id bigint generated always as identity primary key,
  telegram_id bigint not null
    references public.bot_members (telegram_id) on delete cascade,
  product text not null
    check (product in ('course', 'individual', 'group')),
  title text not null,
  total_lessons smallint not null check (total_lessons > 0),
  remaining_lessons smallint not null check (remaining_lessons >= 0),
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  purchased_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lesson_packages_student_idx
  on public.lesson_packages (telegram_id, product, status);

-- ---------------------------------------------------------------------------
-- 3. Запланированные занятия (индивидуальные и групповые)
-- ---------------------------------------------------------------------------
create table if not exists public.scheduled_lessons (
  id bigint generated always as identity primary key,
  telegram_id bigint not null
    references public.bot_members (telegram_id) on delete cascade,
  kind text not null check (kind in ('individual', 'group')),
  -- FK на "groups" добавляется ниже, после education.sql
  group_id bigint,
  package_id bigint references public.lesson_packages (id) on delete set null,
  starts_at timestamptz not null,
  duration_minutes smallint not null default 60,
  topic text not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  is_paid boolean not null default false,
  meet_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_lessons_student_idx
  on public.scheduled_lessons (telegram_id, kind, starts_at desc);
create index if not exists scheduled_lessons_status_idx
  on public.scheduled_lessons (telegram_id, status, starts_at);

-- ---------------------------------------------------------------------------
-- 4. Материалы к занятию
-- ---------------------------------------------------------------------------
create table if not exists public.lesson_materials (
  id bigint generated always as identity primary key,
  lesson_id bigint not null
    references public.scheduled_lessons (id) on delete cascade,
  file_name text not null,
  file_size text,
  storage_path text not null,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists lesson_materials_lesson_idx
  on public.lesson_materials (lesson_id, sort_order);

-- ---------------------------------------------------------------------------
-- 5. Домашние задания
-- ---------------------------------------------------------------------------
create table if not exists public.homework_assignments (
  id bigint generated always as identity primary key,
  lesson_id bigint not null
    references public.scheduled_lessons (id) on delete cascade,
  file_name text not null,
  file_size text,
  storage_path text not null,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'submitted', 'reviewing', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists homework_assignments_lesson_idx
  on public.homework_assignments (lesson_id);

-- ---------------------------------------------------------------------------
-- 6. Прогресс по курсу (дорога занятий)
-- ---------------------------------------------------------------------------
create table if not exists public.course_lesson_progress (
  id bigint generated always as identity primary key,
  telegram_id bigint not null
    references public.bot_members (telegram_id) on delete cascade,
  course_id bigint not null
    references public.courses (id) on delete restrict,
  lesson_index smallint not null check (lesson_index >= 0),
  status text not null default 'locked'
    check (status in ('locked', 'now', 'watched', 'done')),
  updated_at timestamptz not null default now(),
  unique (telegram_id, course_id, lesson_index)
);

create index if not exists course_lesson_progress_student_idx
  on public.course_lesson_progress (telegram_id, course_id);

-- ---------------------------------------------------------------------------
-- 7. История платежей (для раздела «Пакеты»)
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id bigint generated always as identity primary key,
  telegram_id bigint not null
    references public.bot_members (telegram_id) on delete cascade,
  product text not null
    check (product in ('course', 'individual', 'group')),
  amount_byn numeric(10, 2) not null,
  package_id bigint references public.lesson_packages (id) on delete set null,
  external_id text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists payments_student_idx
  on public.payments (telegram_id, paid_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.student_profiles enable row level security;
alter table public.lesson_packages enable row level security;
alter table public.scheduled_lessons enable row level security;
alter table public.lesson_materials enable row level security;
alter table public.homework_assignments enable row level security;
alter table public.course_lesson_progress enable row level security;
alter table public.payments enable row level security;

-- ---------------------------------------------------------------------------
-- 8. Внешние ключи (нужен education.sql — таблица public."groups")
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'groups'
  ) and not exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'scheduled_lessons'
      and constraint_name = 'scheduled_lessons_group_id_fkey'
  ) then
    alter table public.scheduled_lessons
      add constraint scheduled_lessons_group_id_fkey
      foreign key (group_id) references public."groups" (id) on delete set null;
  end if;
end $$;
