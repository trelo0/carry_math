-- Фаза 8: журнал действий администраторов в Telegram-боте.

create table if not exists public.admin_action_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_telegram_id bigint not null,
  action text not null,
  entity_type text,
  entity_id text,
  target_telegram_id bigint,
  detail jsonb
);

create index if not exists admin_action_log_created_idx
  on public.admin_action_log (created_at desc);

create index if not exists admin_action_log_actor_idx
  on public.admin_action_log (actor_telegram_id, created_at desc);

alter table public.admin_action_log enable row level security;
