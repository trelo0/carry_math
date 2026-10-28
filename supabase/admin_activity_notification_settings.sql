-- Включение/выключение типов Telegram-уведомлений админу (панель «Настройки → Уведомления»).
-- Выполнить после admin_user_events.sql.

create table if not exists public.admin_activity_notification_settings (
  kind text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
