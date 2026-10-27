-- Идемпотентность webhook Telegram (update_id).

create table if not exists public.telegram_processed_updates (
  update_id bigint primary key,
  processed_at timestamptz not null default now()
);

create index if not exists telegram_processed_updates_at_idx
  on public.telegram_processed_updates (processed_at desc);

alter table public.telegram_processed_updates enable row level security;
