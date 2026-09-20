-- Прочитанные уведомления куратора (persist вместо in-memory Set).
create table if not exists public.curator_notification_reads (
  curator_telegram_id bigint not null,
  notification_id text not null,
  read_at timestamptz not null default now(),
  primary key (curator_telegram_id, notification_id)
);

create index if not exists curator_notification_reads_curator_idx
  on public.curator_notification_reads (curator_telegram_id, read_at desc);

alter table public.curator_notification_reads enable row level security;
