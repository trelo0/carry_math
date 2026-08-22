-- Выполнить один раз в Supabase: Dashboard → SQL Editor → New query → вставить → Run.
-- Продуктовые доступы пользователей Telegram-бота District.
--
-- bot_members.role отвечает на вопрос «КТО этот пользователь»
-- (guest / student / curator / teacher / admin / test).
-- user_accesses отвечает на вопрос «КАКИМИ ПРОДУКТАМИ он пользуется»:
-- один пользователь может одновременно иметь несколько активных доступов
-- (например, course + individual). Роль для определения продукта НЕ используется.
--
-- Доступ считается действующим только если status = 'active'
-- и (expires_at IS NULL OR expires_at > now()): expires_at = null — бессрочный.

create table if not exists public.user_accesses (
  id bigint generated always as identity primary key,
  telegram_id bigint not null
    references public.bot_members (telegram_id) on delete cascade,
  product text not null
    check (product in ('course', 'individual', 'group')),
  status text not null default 'active'
    check (status in ('active', 'expired', 'cancelled')),
  started_at timestamptz not null default now(),
  -- null = бессрочный доступ.
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- У пользователя максимум одна строка на продукт: повторная выдача после
-- cancelled/expired обновляет существующую запись, а не плодит дубликаты.
create unique index if not exists user_accesses_telegram_product_idx
  on public.user_accesses (telegram_id, product);

-- Активные доступы конкретного пользователя — главный запрос бота.
create index if not exists user_accesses_telegram_id_idx
  on public.user_accesses (telegram_id);

-- Для служебного перевода просроченных доступов в expired.
create index if not exists user_accesses_status_expires_idx
  on public.user_accesses (status, expires_at);

alter table public.user_accesses enable row level security;
-- Политик нет: читает и пишет только сервер через service_role
-- (тот же подход, что и в остальных серверных таблицах проекта).
