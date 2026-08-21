-- Роли участников Telegram-бота District.
-- guest   — зашёл в бота, курс не куплен
-- student — купил курс
-- curator — куратор курса
-- admin   — админ (первый админ задаётся через env ADMIN_TELEGRAM_IDS)
create table if not exists public.bot_members (
  telegram_id bigint not null,
  role text not null default 'guest'::text,
  phone text null,
  full_name text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  view_role text null,
  chat_id bigint null,
  constraint bot_members_pkey primary key (telegram_id)
) TABLESPACE pg_default;

-- Безопасно дополняет старую таблицу, если эти поля ещё отсутствуют.
alter table public.bot_members add column if not exists view_role text;
alter table public.bot_members add column if not exists chat_id bigint;

alter table public.bot_members enable row level security;
-- Политик нет: читает и пишет только сервер через service_role.
