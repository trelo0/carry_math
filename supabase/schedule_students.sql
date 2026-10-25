-- Ученики расписания (без Telegram): добавляются прямо в кабинете преподавателя.
create table if not exists public.schedule_students (
  id bigserial primary key,
  teacher_telegram_id bigint not null,
  name text not null,
  phone text,
  class_label text,
  initial_score numeric,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists schedule_students_teacher_idx
  on public.schedule_students (teacher_telegram_id, name);

alter table public.schedule_students enable row level security;

alter table public.scheduled_lessons
  add column if not exists schedule_student_id bigint references public.schedule_students (id) on delete set null,
  add column if not exists series_id uuid;

create index if not exists scheduled_lessons_series_idx
  on public.scheduled_lessons (series_id) where series_id is not null;
create index if not exists scheduled_lessons_schedule_student_idx
  on public.scheduled_lessons (schedule_student_id) where schedule_student_id is not null;
