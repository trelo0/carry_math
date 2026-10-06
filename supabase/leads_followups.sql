-- Напоминания администратору по заявке (например «клиент думает»).
create table if not exists public.lead_followups (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  kind text not null default 'thinking',
  remind_at timestamptz not null,
  done_at timestamptz,
  note text,
  created_by_telegram_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists lead_followups_due_idx
  on public.lead_followups (remind_at)
  where done_at is null;
