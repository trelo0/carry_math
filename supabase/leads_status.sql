-- Выполнить один раз в Supabase: Dashboard → SQL Editor → New query → вставить → Run.
-- Добавляет заявкам с сайта статусы для раздела «📝 Заявки» в Telegram-боте.
-- Существующие строки получают статус 'new'.

alter table public.leads
  add column if not exists status text not null default 'new';

alter table public.leads
  add column if not exists updated_at timestamptz not null default now();

create index if not exists leads_status_created_idx
  on public.leads (status, created_at desc);
