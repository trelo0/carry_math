-- Выполните этот файл после миграции webinar_reminder_sends.sql,
-- чтобы журнал мог хранить произвольные reminder_type вида custom_<минуты>_minutes.

alter table public.webinar_reminder_sends
  drop constraint if exists webinar_reminder_sends_reminder_type_check;

alter table public.webinar_reminder_sends
  add constraint webinar_reminder_sends_reminder_type_check
  check (
    reminder_type in ('3_days', '1_day', '6_hours', '15_minutes')
    or reminder_type ~ '^custom_[1-9][0-9]*_minutes$'
  );
