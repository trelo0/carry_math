-- Прочитанные входящие уведомления ученика (Мои обращения → Входящие).
create table if not exists public.student_appeal_reads (
  student_telegram_id bigint not null,
  appeal_key text not null,
  read_at timestamptz not null default now(),
  primary key (student_telegram_id, appeal_key)
);

create index if not exists student_appeal_reads_student_idx
  on public.student_appeal_reads (student_telegram_id, read_at desc);

alter table public.student_appeal_reads enable row level security;
