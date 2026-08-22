-- Выполнить один раз в Supabase: Dashboard → SQL Editor → New query → вставить → Run.
-- События контроля переписки Telegram-бота District.
-- Первая версия: только обнаружение, сохранение события и уведомление
-- администраторов. Автоматические блокировки не выполняются.

create table if not exists public.bot_violations (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- Отправитель подозрительного сообщения.
  telegram_id bigint not null,
  chat_id bigint not null,
  message_id bigint not null,
  -- Роль отправителя на момент обнаружения (guest/student/curator/teacher/...).
  sender_role text not null default 'guest',
  sender_name text,
  message_text text not null,
  -- Что найдено: username, link, phrase, username+phrase, link+phrase, mention.
  violation_type text not null,
  -- Уровень риска: low / medium / high.
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  -- Человекочитаемая причина для администратора.
  reason text not null,
  -- Статус обработки: pending / ignored / blocked.
  status text not null default 'pending' check (status in ('pending', 'ignored', 'blocked')),
  -- Кто из администраторов обработал событие и когда.
  reviewed_by bigint,
  reviewed_at timestamptz
);

-- Для списков «новые нарушения» и истории с пагинацией.
create index if not exists bot_violations_status_idx
  on public.bot_violations (status, created_at desc);
create index if not exists bot_violations_created_at_idx
  on public.bot_violations (created_at desc);
-- Для экрана «Нарушения пользователя».
create index if not exists bot_violations_telegram_id_idx
  on public.bot_violations (telegram_id);

alter table public.bot_violations enable row level security;
-- Политик нет: читает и пишет только сервер через service_role.
