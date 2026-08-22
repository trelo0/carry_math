-- Выполнить один раз в Supabase: Dashboard → SQL Editor → New query → вставить → Run.
-- Учебные сущности школы District: курсы, зачисления, группы, назначения.
--
-- Слои данных (разные сущности, не заменять друг друга):
--   bot_members        — КТО пользователь (роль, модерация);
--   user_accesses      — ПРАВО на формат (course / individual / group);
--   эти таблицы        — КОНКРЕТНЫЕ зачисления и назначения
--                        (курс, группа, преподаватель, куратор).
--
-- История обучения не уничтожается: завершение — статусы completed/cancelled,
-- ON DELETE CASCADE только там, где связь действительно принадлежит родителю.
--
-- Примечание: groups — зарезервированное слово PostgreSQL, поэтому имя
-- таблицы в SQL везде в двойных кавычках (в коде используется .from('groups')).

-- ---------------------------------------------------------------------------
-- 1. Каталог курсов
-- ---------------------------------------------------------------------------
create table if not exists public.courses (
  id bigint generated always as identity primary key,
  title text not null,
  slug text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists courses_slug_idx on public.courses (slug);

-- ---------------------------------------------------------------------------
-- 2. Зачисления: ученик ↔ конкретный курс.
--    Удаление участника убирает его зачисления (cascade),
--    удаление курса с историей зачислений запрещено (restrict):
--    курс снимается с публикации через is_active = false.
-- ---------------------------------------------------------------------------
create table if not exists public.course_enrollments (
  id bigint generated always as identity primary key,
  telegram_id bigint not null
    references public.bot_members (telegram_id) on delete cascade,
  course_id bigint not null
    references public.courses (id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Одно зачисление на пару ученик+курс; повторное — обновляет запись.
create unique index if not exists course_enrollments_student_course_idx
  on public.course_enrollments (telegram_id, course_id);
create index if not exists course_enrollments_course_idx
  on public.course_enrollments (course_id);

-- ---------------------------------------------------------------------------
-- 3. Группы. Преподаватель и куратор группы хранятся здесь;
--    состав — в group_members. Связи мягкие: удаление курса/наставника
--    не уничтожает группу (set null).
-- ---------------------------------------------------------------------------
create table if not exists public."groups" (
  id bigint generated always as identity primary key,
  title text not null,
  course_id bigint
    references public.courses (id) on delete set null,
  teacher_telegram_id bigint
    references public.bot_members (telegram_id) on delete set null,
  curator_telegram_id bigint
    references public.bot_members (telegram_id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists groups_course_idx on public."groups" (course_id);
create index if not exists groups_teacher_idx on public."groups" (teacher_telegram_id);
create index if not exists groups_curator_idx on public."groups" (curator_telegram_id);

-- ---------------------------------------------------------------------------
-- 4. Состав групп: ученик ↔ группа.
-- ---------------------------------------------------------------------------
create table if not exists public.group_members (
  id bigint generated always as identity primary key,
  group_id bigint not null
    references public."groups" (id) on delete cascade,
  telegram_id bigint not null
    references public.bot_members (telegram_id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists group_members_group_student_idx
  on public.group_members (group_id, telegram_id);
create index if not exists group_members_student_idx
  on public.group_members (telegram_id);

-- ---------------------------------------------------------------------------
-- 5. Персональные назначения: ученик ↔ преподаватель/куратор.
--    mentor — техническое имя связи, не роль: kind задаёт,
--    кто назначен ('teacher' | 'curator').
--    Роль наставника дополнительно проверяется серверным кодом.
-- ---------------------------------------------------------------------------
create table if not exists public.mentor_assignments (
  id bigint generated always as identity primary key,
  telegram_id bigint not null
    references public.bot_members (telegram_id) on delete cascade,
  mentor_telegram_id bigint not null
    references public.bot_members (telegram_id) on delete cascade,
  kind text not null check (kind in ('teacher', 'curator')),
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Одна запись на тройку ученик+тип+наставник; повторная выдача обновляет её.
create unique index if not exists mentor_assignments_unique_idx
  on public.mentor_assignments (telegram_id, kind, mentor_telegram_id);
create index if not exists mentor_assignments_student_idx
  on public.mentor_assignments (telegram_id, kind, status);
create index if not exists mentor_assignments_mentor_idx
  on public.mentor_assignments (mentor_telegram_id);

-- ---------------------------------------------------------------------------
-- 6. RLS: доступ только серверу через service_role — тот же подход,
--    что и в остальных серверных таблицах. Политик нет: клиентский ключ
--    не может ни назначить себе курс, ни добавить себя в группу,
--    ни назначить себе преподавателя/куратора.
-- ---------------------------------------------------------------------------
alter table public.courses enable row level security;
alter table public.course_enrollments enable row level security;
alter table public."groups" enable row level security;
alter table public.group_members enable row level security;
alter table public.mentor_assignments enable row level security;
