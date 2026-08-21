-- Серверное состояние многошаговых диалогов Telegram-бота.
-- Одна активная сессия на участника: состояние не зависит от памяти serverless-инстанса.
create table if not exists public.bot_conversation_states (
  telegram_id bigint primary key references public.bot_members(telegram_id) on delete cascade,
  chat_id bigint not null,
  message_id bigint not null,
  step text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
) tablespace pg_default;

alter table public.bot_conversation_states enable row level security;
-- Политик нет: таблицу читает и изменяет только webhook через service_role.
