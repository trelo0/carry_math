-- Фаза 3: ответственный и история статусов заявок.
-- Выполнить в Supabase SQL Editor после leads_status.sql.

alter table public.leads
  add column if not exists assigned_telegram_id bigint;

create index if not exists leads_assigned_telegram_idx
  on public.leads (assigned_telegram_id)
  where assigned_telegram_id is not null;

create table if not exists public.lead_status_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  status text not null,
  changed_by_telegram_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists lead_status_history_lead_created_idx
  on public.lead_status_history (lead_id, created_at desc);

alter table public.lead_status_history enable row level security;
