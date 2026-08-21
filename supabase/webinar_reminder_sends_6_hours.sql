-- Примените этот файл, если supabase/webinar_reminder_sends.sql уже был выполнен ранее.
-- Заменяет устаревший тип 3_hours на 6_hours в ограничении reminder_type.

alter table public.webinar_reminder_sends
  drop constraint if exists webinar_reminder_sends_reminder_type_check;

alter table public.webinar_reminder_sends
  add constraint webinar_reminder_sends_reminder_type_check
  check (reminder_type in ('3_days', '1_day', '6_hours', '15_minutes'));
