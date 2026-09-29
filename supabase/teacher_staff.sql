-- Расписание и переносы преподавателя (staff-кабинет).

create table if not exists public.teacher_availability (
  id bigserial primary key,
  teacher_telegram_id bigint not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  kind text not null default 'both' check (kind in ('individual', 'group', 'both')),
  created_at timestamptz not null default now()
);

create index if not exists teacher_availability_teacher_idx
  on public.teacher_availability (teacher_telegram_id, day_of_week);

create table if not exists public.teacher_blocked_dates (
  id bigserial primary key,
  teacher_telegram_id bigint not null,
  blocked_date date not null,
  note text,
  created_at timestamptz not null default now(),
  unique (teacher_telegram_id, blocked_date)
);

create index if not exists teacher_blocked_dates_teacher_idx
  on public.teacher_blocked_dates (teacher_telegram_id, blocked_date);

create table if not exists public.lesson_reschedule_proposals (
  id bigserial primary key,
  lesson_id bigint not null references public.scheduled_lessons (id) on delete cascade,
  proposed_by bigint not null,
  options jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'cancelled')),
  chosen_starts_at timestamptz,
  chosen_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists lesson_reschedule_proposals_lesson_idx
  on public.lesson_reschedule_proposals (lesson_id, status);

create index if not exists scheduled_lessons_teacher_idx
  on public.scheduled_lessons (teacher_telegram_id, starts_at desc);

alter table public.teacher_availability enable row level security;
alter table public.teacher_blocked_dates enable row level security;
alter table public.lesson_reschedule_proposals enable row level security;
