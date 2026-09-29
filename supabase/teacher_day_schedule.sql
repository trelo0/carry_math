-- Дневное расписание преподавателя и кабинет занятия.

alter table public.scheduled_lessons
  add column if not exists board_url text;

alter table public.scheduled_lessons
  add column if not exists lesson_plan text;

create table if not exists public.teacher_day_slots (
  id bigserial primary key,
  teacher_telegram_id bigint not null,
  slot_date date not null,
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now()
);

create index if not exists teacher_day_slots_teacher_date_idx
  on public.teacher_day_slots (teacher_telegram_id, slot_date);

create table if not exists public.teacher_student_notes (
  teacher_telegram_id bigint not null,
  student_telegram_id bigint not null,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (teacher_telegram_id, student_telegram_id)
);

create table if not exists public.teacher_group_notes (
  teacher_telegram_id bigint not null,
  group_id bigint not null references public."groups" (id) on delete cascade,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (teacher_telegram_id, group_id)
);

alter table public.teacher_day_slots enable row level security;
alter table public.teacher_student_notes enable row level security;
alter table public.teacher_group_notes enable row level security;
