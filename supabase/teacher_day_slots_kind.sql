-- Тип дневного слота: extra = доп. окно для booking, blocked = занято (без ученика).
alter table public.teacher_day_slots
  add column if not exists slot_kind text not null default 'extra'
    check (slot_kind in ('extra', 'blocked'));

alter table public.teacher_day_slots
  add column if not exists label text;
