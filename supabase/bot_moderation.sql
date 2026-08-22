-- Выполнить один раз в Supabase: Dashboard → SQL Editor → New query → вставить → Run.
-- Полноценный контроль переписки Telegram-бота District.
-- Миграция идемпотентна: работает и на пустой базе, и поверх ранее
-- применённой supabase/bot_violations.sql.

-- ---------------------------------------------------------------------------
-- 1. Таблица событий контроля. Если её ещё нет — создаётся сразу в финальной
--    схеме (recipient_telegram_id, action_by/action_at, полный набор статусов).
-- ---------------------------------------------------------------------------
create table if not exists public.bot_violations (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- Отправитель подозрительного сообщения.
  telegram_id bigint not null,
  chat_id bigint not null,
  message_id bigint not null,
  -- Получатель, если известен. Сейчас бот работает только в личных чатах,
  -- поэтому получатель — сам бот и поле остаётся null (зарезервировано).
  recipient_telegram_id bigint,
  -- Роль отправителя на момент обнаружения (guest/student/curator/teacher/...).
  sender_role text not null default 'guest',
  sender_name text,
  message_text text not null,
  -- Что найдено: username, link, bypass, phrase, username+phrase, mention...
  violation_type text not null,
  -- Уровень риска: low / medium / high (null-детект детектора = SAFE).
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  -- Человекочитаемая причина для администратора.
  reason text not null,
  -- Статус обработки: pending / ignored / warned / restricted / blocked.
  status text not null default 'pending'
    check (status in ('pending', 'ignored', 'warned', 'restricted', 'blocked')),
  -- Кто из администраторов выполнил действие и когда.
  action_by bigint,
  action_at timestamptz
);

-- ---------------------------------------------------------------------------
-- 2. Обновление таблицы, если она уже была создана миграцией bot_violations.sql.
-- ---------------------------------------------------------------------------
alter table public.bot_violations add column if not exists recipient_telegram_id bigint;

-- reviewed_by/reviewed_at → action_by/action_at (только для старой схемы).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bot_violations' and column_name = 'reviewed_by'
  ) then
    alter table public.bot_violations rename column reviewed_by to action_by;
    alter table public.bot_violations rename column reviewed_at to action_at;
  end if;
end $$;

-- Расширяем набор статусов: warned и restricted добавлены в этой версии.
alter table public.bot_violations drop constraint if exists bot_violations_status_check;
alter table public.bot_violations add constraint bot_violations_status_check
  check (status in ('pending', 'ignored', 'warned', 'restricted', 'blocked'));

-- Для списков «новые нарушения», истории и пагинации.
create index if not exists bot_violations_status_idx
  on public.bot_violations (status, created_at desc);
create index if not exists bot_violations_created_at_idx
  on public.bot_violations (created_at desc);
-- Для экрана «Нарушения пользователя» и счётчиков.
create index if not exists bot_violations_telegram_id_idx
  on public.bot_violations (telegram_id);

alter table public.bot_violations enable row level security;
-- Политик нет: читает и пишет только сервер через service_role.

-- ---------------------------------------------------------------------------
-- 3. Статус модерации пользователя в существующей bot_members.
--    active — обычный доступ; restricted — общение ограничено; blocked — заблокирован.
--    Пользователь не удаляется, блокировка обратима администратором.
-- ---------------------------------------------------------------------------
alter table public.bot_members add column if not exists moderation_status text not null default 'active';
alter table public.bot_members drop constraint if exists bot_members_moderation_status_check;
alter table public.bot_members add constraint bot_members_moderation_status_check
  check (moderation_status in ('active', 'restricted', 'blocked'));

alter table public.bot_members add column if not exists restricted_at timestamptz;
alter table public.bot_members add column if not exists restricted_by bigint;
alter table public.bot_members add column if not exists blocked_at timestamptz;
alter table public.bot_members add column if not exists blocked_by bigint;

create index if not exists bot_members_moderation_status_idx
  on public.bot_members (moderation_status);
