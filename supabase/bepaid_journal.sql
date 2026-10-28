-- Единый журнал транзакций bePaid (просмотр и контроль поступлений).
-- Не связан с bot_members / payments и не участвует в выдаче товара.
-- Применить вручную: Supabase SQL Editor.

create table if not exists public.bepaid_transactions (
  id bigint generated always as identity primary key,
  -- uid транзакции bePaid — глобально уникален; защита от дублей webhook/синхронизации
  uid text not null unique,
  -- site: динамический платёж сайта (tracking_id = purchase_requests.id); product: готовый продукт bePaid
  source text not null check (source in ('site', 'product')),
  kind text not null default 'payment' check (kind in ('payment', 'refund')),
  status text not null check (status in ('paid', 'pending', 'failed', 'cancelled', 'refunded')),
  bepaid_status text,
  amount_minor bigint not null,
  currency text not null default 'BYN',
  payer_name text,
  product_title text,
  tracking_id text,
  order_id bigint,
  is_test boolean not null default false,
  -- способ оплаты: card | erip | other
  payment_method text check (payment_method in ('card', 'erip', 'other')),
  -- paid_at, если есть, иначе created_at транзакции в bePaid
  occurred_at timestamptz not null,
  paid_at timestamptz,
  bepaid_created_at timestamptz,
  synced_at timestamptz not null default now()
);

-- Для уже созданной таблицы (без способа оплаты):
alter table public.bepaid_transactions
  add column if not exists payment_method text check (payment_method in ('card', 'erip', 'other'));

create index if not exists bepaid_transactions_occurred_idx
  on public.bepaid_transactions (occurred_at desc);

create index if not exists bepaid_transactions_status_idx
  on public.bepaid_transactions (status, occurred_at desc);

alter table public.bepaid_transactions enable row level security;
-- Политик нет: доступ только через service role (серверный admin-клиент).
