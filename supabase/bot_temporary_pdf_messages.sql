-- Временное PDF-сообщение гостевого сценария.
-- Хранится отдельно от bot_members и состояния админских диалогов.
create table if not exists public.bot_temporary_pdf_messages (
  telegram_id bigint primary key references public.bot_members(telegram_id) on delete cascade,
  chat_id bigint not null,
  menu_message_id bigint not null,
  pdf_message_id bigint not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
) tablespace pg_default;

-- Безопасно дополняет таблицу, если ранняя версия миграции уже была применена.
alter table public.bot_temporary_pdf_messages add column if not exists menu_message_id bigint;

alter table public.bot_temporary_pdf_messages enable row level security;
-- Политик нет: таблицу читает и изменяет только webhook через service_role.
