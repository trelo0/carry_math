-- Статус вебинара по Sanity lesson id (управляет куратор из веб-кабинета).
-- Порядок: course_sanity_keys.sql → этот файл.

create table if not exists public.sanity_lesson_sessions (
  id bigint generated always as identity primary key,
  sanity_lesson_id text not null unique,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'waiting', 'live', 'completed', 'cancelled')),
  started_at timestamptz,
  ended_at timestamptz,
  started_by bigint references public.bot_members (telegram_id) on delete set null,
  ended_by bigint references public.bot_members (telegram_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sanity_lesson_sessions_status_idx
  on public.sanity_lesson_sessions (status);

alter table public.sanity_lesson_sessions enable row level security;
