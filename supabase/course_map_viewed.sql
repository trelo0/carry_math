-- Флаг «ученик открыл карту курса» (кнопка в превью кабинета).
-- Выполнить в Supabase SQL Editor после cabinet_data.sql.

alter table public.student_profiles
  add column if not exists course_map_viewed_at timestamptz;
