-- Выполнить один раз в Supabase: Dashboard → SQL Editor → New query → вставить → Run.
-- Таблицы для входа по одноразовому коду из Telegram.
-- RLS включён без политик: anon/authenticated доступа не имеют,
-- читает и пишет только service role (серверные API-роуты).

create table if not exists public.telegram_links (
  phone text primary key,
  telegram_id bigint not null,
  user_id uuid,
  linked_at timestamptz not null default now()
);

create table if not exists public.telegram_link_tokens (
  token text primary key,
  phone text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  attempts integer not null default 0,
  last_sent_at timestamptz not null default now()
);

create index if not exists otp_codes_phone_idx
  on public.otp_codes (phone, created_at desc);

alter table public.telegram_links enable row level security;
alter table public.telegram_link_tokens enable row level security;
alter table public.otp_codes enable row level security;
