-- Бизнес-проблемы для раздела «🔴 Проблемы» (не технический лог).

create table if not exists public.admin_problems (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  status text not null default 'attention'
    check (status in ('critical', 'attention', 'resolved')),
  category text not null default 'system',
  title text not null,
  description text,
  entity_type text,
  entity_id text,
  open_callback text,
  source text not null default 'system',
  detail jsonb
);

create index if not exists admin_problems_status_created_idx
  on public.admin_problems (status, created_at desc);

create index if not exists admin_problems_entity_idx
  on public.admin_problems (entity_type, entity_id);

alter table public.admin_problems enable row level security;
