-- Заявки на покупку через Telegram-бот (до подключения эквайринга).
-- Выполнить один раз: Supabase Dashboard → SQL Editor → Run.

create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  telegram_id bigint not null references public.bot_members(telegram_id) on delete cascade,
  product text not null check (product in ('course', 'individual', 'group')),
  package_index int not null default 0,
  teacher_id text,
  title text not null,
  amount_byn numeric(10, 2) not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  resolved_by bigint references public.bot_members(telegram_id) on delete set null
);

create index if not exists purchase_requests_status_created_idx
  on public.purchase_requests (status, created_at desc);

create index if not exists purchase_requests_telegram_idx
  on public.purchase_requests (telegram_id, created_at desc);

-- Одна pending-заявка на комбинацию продукт + пакет + преподаватель.
create unique index if not exists purchase_requests_pending_unique_idx
  on public.purchase_requests (telegram_id, product, package_index, coalesce(teacher_id, ''))
  where status = 'pending';

alter table public.purchase_requests enable row level security;
