-- События активности учеников для Telegram-уведомлений администратору.
-- Выполнить в Supabase SQL Editor после cabinet_data / courses.

create table if not exists public.admin_user_events (
  id bigserial primary key,
  kind text not null,
  user_id uuid,
  telegram_id bigint,
  course_id bigint references public.courses (id) on delete set null,
  source text,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  occurred_at timestamptz not null default now(),
  telegram_notified_at timestamptz,
  constraint admin_user_events_dedupe_key unique (dedupe_key)
);

create index if not exists admin_user_events_occurred_at_idx
  on public.admin_user_events (occurred_at desc);

create index if not exists admin_user_events_user_id_idx
  on public.admin_user_events (user_id)
  where user_id is not null;

-- Первое открытие карты курса (отдельно для каждого курса).
create table if not exists public.student_course_map_first_view (
  telegram_id bigint not null,
  course_id bigint not null references public.courses (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (telegram_id, course_id)
);

-- Намерение CTA на главной до авторизации (cookie → token).
create table if not exists public.cta_intents (
  token uuid primary key default gen_random_uuid(),
  source text not null check (source in ('home_hero', 'home_initiation')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  user_id uuid
);

create index if not exists cta_intents_open_idx
  on public.cta_intents (expires_at)
  where consumed_at is null;
