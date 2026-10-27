-- Telegram Topics (Threaded Mode): один топик на пару staff ↔ ученик (check / admin).
-- Порядок: bot_members.sql → staff_student_messages.sql (опционально) → этот файл.

create table if not exists public.staff_dm_topics (
  id bigint generated always as identity primary key,
  staff_telegram_id bigint not null references public.bot_members (telegram_id) on delete cascade,
  student_telegram_id bigint not null references public.bot_members (telegram_id) on delete cascade,
  staff_role text not null check (staff_role in ('check', 'admin')),
  message_thread_id bigint not null,
  topic_name text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_dm_topics_pair_uidx unique (staff_telegram_id, student_telegram_id)
);

create index if not exists staff_dm_topics_thread_idx
  on public.staff_dm_topics (staff_telegram_id, message_thread_id)
  where status = 'active';

create index if not exists staff_dm_topics_student_idx
  on public.staff_dm_topics (student_telegram_id, status);

alter table public.staff_dm_topics enable row level security;
