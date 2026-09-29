-- Заявки ученика на обычные ind/group занятия (до подтверждения teacher).

create table if not exists public.lesson_booking_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  student_telegram_id bigint not null references public.bot_members (telegram_id) on delete cascade,
  teacher_telegram_id bigint not null references public.bot_members (telegram_id) on delete cascade,
  kind text not null check (kind in ('individual', 'group')),
  group_id bigint references public."groups" (id) on delete set null,
  package_id bigint references public.lesson_packages (id) on delete set null,
  starts_at timestamptz not null,
  duration_minutes smallint not null default 60,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'cancelled')),
  scheduled_lesson_id bigint references public.scheduled_lessons (id) on delete set null,
  resolved_by bigint references public.bot_members (telegram_id) on delete set null
);

create index if not exists lesson_booking_requests_teacher_status_idx
  on public.lesson_booking_requests (teacher_telegram_id, status, starts_at);

create index if not exists lesson_booking_requests_student_status_idx
  on public.lesson_booking_requests (student_telegram_id, status, created_at desc);

-- Один pending на точное время у teacher (защита от гонки на слот).
create unique index if not exists lesson_booking_requests_teacher_slot_pending_idx
  on public.lesson_booking_requests (teacher_telegram_id, starts_at)
  where status = 'pending';

alter table public.lesson_booking_requests enable row level security;
