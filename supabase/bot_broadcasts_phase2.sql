-- Расширение bot_broadcasts: планирование и фоновая отправка.
-- Выполнить после bot_broadcasts.sql.

alter table public.bot_broadcasts
  add column if not exists status text not null default 'completed';

alter table public.bot_broadcasts
  add column if not exists scheduled_at timestamptz;

alter table public.bot_broadcasts
  add column if not exists title text;

alter table public.bot_broadcasts
  add column if not exists payload jsonb;

alter table public.bot_broadcasts
  add column if not exists pending_chat_ids jsonb not null default '[]'::jsonb;

alter table public.bot_broadcasts
  add column if not exists admin_notify_chat_id bigint;

create index if not exists bot_broadcasts_status_scheduled_idx
  on public.bot_broadcasts (status, scheduled_at)
  where status in ('scheduled', 'sending');
