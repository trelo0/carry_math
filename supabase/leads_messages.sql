-- История переписки по заявке (админ ↔ клиент через District-бот).
create table if not exists public.lead_messages (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  direction text not null check (direction in ('client_to_admin', 'admin_to_client')),
  sender_telegram_id bigint,
  telegram_message_id bigint,
  body text,
  message_type text not null default 'text',
  attachment jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lead_messages_lead_id_created_at_idx
  on public.lead_messages (lead_id, created_at desc);
