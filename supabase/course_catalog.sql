-- Каталог курса, доступ к урокам, прогресс, жизни, grants пакетов.
-- Порядок: bot_roles → telegram_auth → user_accesses → education → cabinet_data → этот файл.
--
-- RLS: политик нет, доступ только через service_role (как в остальных таблицах проекта).

-- ---------------------------------------------------------------------------
-- 1. Модули и уроки курса (каталог)
-- ---------------------------------------------------------------------------
create table if not exists public.course_modules (
  id bigint generated always as identity primary key,
  course_id bigint not null references public.courses (id) on delete restrict,
  title text not null,
  color text not null default '#4f7cff',
  about text,
  sort_order smallint not null default 0,
  lesson_count smallint not null check (lesson_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists course_modules_course_idx
  on public.course_modules (course_id, sort_order);

create table if not exists public.course_lessons (
  id bigint generated always as identity primary key,
  course_id bigint not null references public.courses (id) on delete restrict,
  module_id bigint not null references public.course_modules (id) on delete restrict,
  lesson_index smallint not null check (lesson_index >= 0),
  num_in_module smallint not null check (num_in_module > 0),
  title text not null,
  kind text not null default 'webinar'
    check (kind in ('webinar', 'practice', 'milestone')),
  is_trial_free boolean not null default false,
  mandatory_homework boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, lesson_index),
  unique (module_id, num_in_module)
);

create index if not exists course_lessons_course_idx
  on public.course_lessons (course_id, lesson_index);

-- ---------------------------------------------------------------------------
-- 2. Сессия/вебинар урока (live + запись)
-- ---------------------------------------------------------------------------
create table if not exists public.course_lesson_sessions (
  id bigint generated always as identity primary key,
  course_lesson_id bigint not null unique
    references public.course_lessons (id) on delete cascade,
  starts_at timestamptz,
  duration_minutes smallint not null default 90,
  live_url text,
  recording_url text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'live', 'completed', 'cancelled')),
  conducted_at timestamptz,
  conducted_by bigint references public.bot_members (telegram_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Материалы и ДЗ урока курса
-- ---------------------------------------------------------------------------
create table if not exists public.course_lesson_materials (
  id bigint generated always as identity primary key,
  course_lesson_id bigint not null
    references public.course_lessons (id) on delete cascade,
  material_type text not null default 'file'
    check (material_type in ('file', 'link', 'text')),
  title text not null,
  file_name text,
  file_size text,
  storage_path text,
  url text,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists course_lesson_materials_lesson_idx
  on public.course_lesson_materials (course_lesson_id, sort_order);

create table if not exists public.course_lesson_homework (
  id bigint generated always as identity primary key,
  course_lesson_id bigint not null unique
    references public.course_lessons (id) on delete cascade,
  title text not null,
  file_name text,
  file_size text,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. Доступ ученика к конкретным урокам
-- ---------------------------------------------------------------------------
create table if not exists public.course_lesson_access (
  id bigint generated always as identity primary key,
  telegram_id bigint not null
    references public.bot_members (telegram_id) on delete cascade,
  course_lesson_id bigint not null
    references public.course_lessons (id) on delete cascade,
  access_status text not null default 'available'
    check (access_status in ('available', 'blocked_lives', 'revoked')),
  source text not null
    check (source in ('enrollment', 'package', 'bonus')),
  package_id bigint references public.lesson_packages (id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (telegram_id, course_lesson_id)
);

create index if not exists course_lesson_access_student_idx
  on public.course_lesson_access (telegram_id, access_status);

-- ---------------------------------------------------------------------------
-- 5. Прогресс ученика по уроку (отдельно от доступа)
-- ---------------------------------------------------------------------------
create table if not exists public.course_lesson_student_progress (
  id bigint generated always as identity primary key,
  telegram_id bigint not null
    references public.bot_members (telegram_id) on delete cascade,
  course_lesson_id bigint not null
    references public.course_lessons (id) on delete cascade,
  live_attended_at timestamptz,
  recording_watched_at timestamptz,
  homework_status text not null default 'pending'
    check (homework_status in ('pending', 'submitted', 'approved', 'rejected')),
  homework_completed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (telegram_id, course_lesson_id)
);

create index if not exists course_lesson_student_progress_student_idx
  on public.course_lesson_student_progress (telegram_id, course_lesson_id);

-- ---------------------------------------------------------------------------
-- 6. Жизни на зачисление
-- ---------------------------------------------------------------------------
create table if not exists public.course_enrollment_state (
  telegram_id bigint not null
    references public.bot_members (telegram_id) on delete cascade,
  course_id bigint not null
    references public.courses (id) on delete restrict,
  lives_current smallint not null default 3 check (lives_current >= 0),
  lives_max smallint not null default 3 check (lives_max > 0),
  access_blocked boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (telegram_id, course_id)
);

create table if not exists public.course_life_events (
  id bigint generated always as identity primary key,
  telegram_id bigint not null
    references public.bot_members (telegram_id) on delete cascade,
  course_id bigint not null
    references public.courses (id) on delete restrict,
  delta smallint not null check (delta in (-1, 1)),
  reason text not null,
  curator_telegram_id bigint
    references public.bot_members (telegram_id) on delete set null,
  course_lesson_id bigint
    references public.course_lessons (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists course_life_events_student_idx
  on public.course_life_events (telegram_id, course_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 7. Какие уроки открыл конкретный пакет
-- ---------------------------------------------------------------------------
create table if not exists public.package_lesson_grants (
  id bigint generated always as identity primary key,
  package_id bigint not null
    references public.lesson_packages (id) on delete cascade,
  course_lesson_id bigint not null
    references public.course_lessons (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (package_id, course_lesson_id)
);

create index if not exists package_lesson_grants_package_idx
  on public.package_lesson_grants (package_id);

-- ---------------------------------------------------------------------------
-- 8. Доработка существующих таблиц
-- ---------------------------------------------------------------------------
alter table public.lesson_packages
  add column if not exists used_lessons smallint not null default 0;

alter table public.scheduled_lessons
  add column if not exists teacher_telegram_id bigint
    references public.bot_members (telegram_id) on delete set null;

alter table public.scheduled_lessons
  add column if not exists completed_at timestamptz;

alter table public.scheduled_lessons
  add column if not exists completed_by bigint
    references public.bot_members (telegram_id) on delete set null;

alter table public.scheduled_lessons
  add column if not exists consumed_at timestamptz;

alter table public.payments
  add column if not exists status text not null default 'paid'
    check (status in ('pending', 'paid', 'failed', 'refunded'));

alter table public.payments
  add column if not exists provider text;

alter table public.payments
  add column if not exists checkout_token text;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.course_modules enable row level security;
alter table public.course_lessons enable row level security;
alter table public.course_lesson_sessions enable row level security;
alter table public.course_lesson_materials enable row level security;
alter table public.course_lesson_homework enable row level security;
alter table public.course_lesson_access enable row level security;
alter table public.course_lesson_student_progress enable row level security;
alter table public.course_enrollment_state enable row level security;
alter table public.course_life_events enable row level security;
alter table public.package_lesson_grants enable row level security;

-- ---------------------------------------------------------------------------
-- Домашка курса: текст/файл отправки (п.3)
-- ---------------------------------------------------------------------------
alter table public.course_lesson_student_progress
  add column if not exists homework_submitted_at timestamptz;

alter table public.course_lesson_student_progress
  add column if not exists submission_note text;

alter table public.course_lesson_student_progress
  add column if not exists submission_file_url text;
