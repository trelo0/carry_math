-- Дедлайны ДЗ (72ч с первого открытия) + sticky-заморозка enrollment.

alter table public.course_lesson_student_progress
  add column if not exists lesson_first_opened_at timestamptz;

alter table public.course_lesson_student_progress
  add column if not exists homework_deadline_at timestamptz;

alter table public.course_lesson_student_progress
  add column if not exists homework_remaining_ms bigint;

alter table public.course_lesson_student_progress
  add column if not exists homework_overdue_at timestamptz;

alter table public.course_lesson_student_progress
  add column if not exists hw_remind_12h_at timestamptz;

alter table public.course_lesson_student_progress
  add column if not exists hw_remind_6h_at timestamptz;

alter table public.course_lesson_student_progress
  add column if not exists hw_remind_2h_at timestamptz;

alter table public.course_lesson_student_progress
  add column if not exists hw_overdue_student_at timestamptz;

alter table public.course_lesson_student_progress
  add column if not exists hw_overdue_curator_at timestamptz;

alter table public.course_enrollment_state
  add column if not exists frozen_at timestamptz;

alter table public.course_enrollment_state
  add column if not exists frozen_reason text;

-- unfreeze пишет delta=0
alter table public.course_life_events
  drop constraint if exists course_life_events_delta_check;

alter table public.course_life_events
  add constraint course_life_events_delta_check
  check (delta >= -3 and delta <= 3);

create index if not exists course_lesson_progress_hw_deadline_idx
  on public.course_lesson_student_progress (homework_deadline_at)
  where homework_deadline_at is not null
    and homework_status in ('pending', 'rejected');

comment on column public.course_lesson_student_progress.lesson_first_opened_at is
  'Первое открытие занятия учеником (старт таймера ДЗ).';
comment on column public.course_lesson_student_progress.homework_deadline_at is
  'Активный дедлайн сдачи ДЗ (пауза при submitted).';
comment on column public.course_lesson_student_progress.homework_remaining_ms is
  'Остаток таймера (мс) на момент отправки ДЗ на проверку.';
comment on column public.course_enrollment_state.access_blocked is
  'Sticky-заморозка: новые занятия не открываются до ручной разморозки.';
