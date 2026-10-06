-- Пробные занятия, оплата пробного, события заявки.

alter table public.scheduled_lessons
  drop constraint if exists scheduled_lessons_kind_check;

alter table public.scheduled_lessons
  add constraint scheduled_lessons_kind_check
  check (kind in ('individual', 'group', 'trial'));

alter table public.scheduled_lessons
  add column if not exists lead_id uuid references public.leads (id) on delete set null;

alter table public.scheduled_lessons
  add column if not exists trial_price_byn numeric(10, 2);

alter table public.scheduled_lessons
  add column if not exists trial_payment_status text not null default 'not_requested'
  check (trial_payment_status in ('not_requested', 'pending', 'paid', 'skipped', 'failed'));

create index if not exists scheduled_lessons_lead_id_idx
  on public.scheduled_lessons (lead_id)
  where lead_id is not null;

alter table public.payments
  drop constraint if exists payments_product_check;

alter table public.payments
  add constraint payments_product_check
  check (product in ('course', 'individual', 'group', 'trial'));

alter table public.payments
  add column if not exists lead_id uuid references public.leads (id) on delete set null;

alter table public.payments
  add column if not exists scheduled_lesson_id bigint references public.scheduled_lessons (id) on delete set null;

create table if not exists public.lead_events (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  event_type text not null,
  detail jsonb,
  actor_telegram_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists lead_events_lead_id_created_at_idx
  on public.lead_events (lead_id, created_at desc);
