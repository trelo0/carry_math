-- Тип обращения: заявка на обучение / вопрос студента / вопрос гостя.

alter table public.leads
  add column if not exists inquiry_kind text not null default 'application'
  check (inquiry_kind in ('application', 'student_question', 'guest_question'));

alter table public.leads
  add column if not exists client_telegram_id bigint;

create index if not exists leads_inquiry_kind_status_idx
  on public.leads (inquiry_kind, status, created_at desc);

create index if not exists leads_client_telegram_idx
  on public.leads (client_telegram_id)
  where client_telegram_id is not null;
