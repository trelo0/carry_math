-- Роли участников Telegram-бота District.
-- guest   — зашёл в бота, курс не куплен
-- student — купил курс
-- curator — куратор курса
-- admin   — админ (первый админ задаётся через env ADMIN_TELEGRAM_IDS)
create table if not exists public.bot_members (
  telegram_id bigint primary key,
  role text not null default 'guest',
  phone text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bot_members enable row level security;
-- Политик нет: читает и пишет только сервер через service_role.
