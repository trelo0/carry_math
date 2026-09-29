-- Черновые занятия без ученика + тип перерыва в day slots.

alter table public.scheduled_lessons
  alter column telegram_id drop not null;

alter table public.teacher_day_slots
  drop constraint if exists teacher_day_slots_slot_kind_check;

alter table public.teacher_day_slots
  add constraint teacher_day_slots_slot_kind_check
  check (slot_kind in ('extra', 'blocked', 'break'));
