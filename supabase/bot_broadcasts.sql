-- Выполнить один раз в Supabase: Dashboard → SQL Editor → New query → вставить → Run.
-- История массовых рассылок Telegram-бота District.
-- Каждая рассылка — одна строка; ошибки хранятся в jsonb и привязаны к id рассылки.

create table if not exists public.bot_broadcasts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  admin_telegram_id bigint not null,
  audience_id text not null,
  audience_title text not null,
  to_admins boolean not null default false,
  text_preview text not null,
  has_attachment boolean not null default false,
  has_button boolean not null default false,
  recipients integer not null default 0,
  delivered integer not null default 0,
  failed integer not null default 0,
  -- [{ "name": "chat 123", "reason": "bot was blocked by the user" }, ...]
  errors jsonb not null default '[]'::jsonb
);

alter table public.bot_broadcasts enable row level security;
-- Политик нет: читает и пишет только сервер через service_role.
