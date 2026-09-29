-- Дополнительные роли участника (основная остаётся в bot_members.role).
-- Пример: role=teacher, extra_roles={curator} → преподаватель + куратор.

alter table public.bot_members
  add column if not exists extra_roles text[] not null default '{}';

create index if not exists bot_members_extra_roles_gin_idx
  on public.bot_members using gin (extra_roles);
