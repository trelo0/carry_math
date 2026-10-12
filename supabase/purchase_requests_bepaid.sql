-- Добавление поля для отслеживания транзакции bePaid и защиты от повторной обработки.
-- Выполнить один раз: Supabase Dashboard → SQL Editor → Run.

alter table public.purchase_requests
  add column if not exists bepaid_transaction_uid text;

-- Индекс для быстрого поиска по bepaid_transaction_uid
create index if not exists purchase_requests_bepaid_idx
  on public.purchase_requests (bepaid_transaction_uid)
  where bepaid_transaction_uid is not null;
