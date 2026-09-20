-- Одноразовые токены входа в кабинет из Telegram-бота.
create table if not exists public.cabinet_login_tokens (
  token text primary key,
  telegram_id bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists cabinet_login_tokens_telegram_idx
  on public.cabinet_login_tokens (telegram_id, created_at desc);

alter table public.cabinet_login_tokens enable row level security;
