-- Полная блокировка курса (отдельно от заморозки по жизням) + расширенная история жизней.

alter table public.course_enrollment_state
  add column if not exists fully_blocked boolean not null default false;

alter table public.course_enrollment_state
  add column if not exists fully_blocked_at timestamptz;

alter table public.course_enrollment_state
  add column if not exists fully_blocked_by bigint;

alter table public.course_enrollment_state
  add column if not exists fully_blocked_reason text;

alter table public.course_enrollment_state
  add column if not exists lives_zero_notified_at timestamptz;

alter table public.course_life_events
  add column if not exists lives_before smallint;

alter table public.course_life_events
  add column if not exists lives_after smallint;

alter table public.course_life_events
  add column if not exists operation_type text;

alter table public.course_life_events
  add column if not exists period_key text;

alter table public.course_life_events
  drop constraint if exists course_life_events_delta_check;

alter table public.course_life_events
  add constraint course_life_events_delta_check
  check (delta >= -3 and delta <= 3);

create unique index if not exists course_life_events_monthly_restore_idx
  on public.course_life_events (telegram_id, course_id, period_key)
  where operation_type = 'monthly_restore' and period_key is not null;

comment on column public.course_enrollment_state.access_blocked is
  'Обычная заморозка: 0 жизней, новые занятия не открываются, уже available остаются.';
comment on column public.course_enrollment_state.fully_blocked is
  'Полная блокировка администратором: все материалы закрыты до ручного снятия.';
