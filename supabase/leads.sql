-- Выполнить один раз в Supabase: Dashboard → SQL Editor → New query → вставить → Run.
-- Таблица заявок с форм сайта.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  contact text not null,
  comment text,
  teacher text,
  service text,
  grade text,
  rating text,
  rt_score text,
  price text,
  waitlist boolean not null default false,
  spots_status text,
  source text,
  ip text
);

alter table public.leads enable row level security;

-- С сайта (аноним) можно только создавать заявки.
-- Читать/менять/удалять без ключа сервиса нельзя.
drop policy if exists "leads_insert" on public.leads;
create policy "leads_insert"
  on public.leads
  for insert
  to anon, authenticated
  with check (true);
