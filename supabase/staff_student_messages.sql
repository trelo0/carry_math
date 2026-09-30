-- Переписка staff (teacher/curator) ↔ ученик через Telegram-бот.
-- Порядок: bot_roles.sql → education.sql → этот файл.
-- Без таблицы бот всё равно доставляет сообщения, но без inbox и истории.

create table if not exists public.staff_student_messages (
  id bigint generated always as identity primary key,
  staff_telegram_id bigint not null references public.bot_members (telegram_id) on delete cascade,
  student_telegram_id bigint not null references public.bot_members (telegram_id) on delete cascade,
  staff_role text not null check (staff_role in ('teacher', 'curator')),
  direction text not null check (direction in ('student_to_staff', 'staff_to_student')),
  body text not null default '',
  attachment_ref text,
  attachment_kind text check (attachment_kind is null or attachment_kind in ('photo', 'document', 'voice')),
  staff_read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists staff_student_messages_staff_idx
  on public.staff_student_messages (staff_telegram_id, staff_role, created_at desc);

create index if not exists staff_student_messages_thread_idx
  on public.staff_student_messages (staff_telegram_id, student_telegram_id, created_at desc);

create index if not exists staff_student_messages_unread_idx
  on public.staff_student_messages (staff_telegram_id, staff_role)
  where direction = 'student_to_staff' and staff_read_at is null;

alter table public.staff_student_messages enable row level security;
