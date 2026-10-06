-- Мета проверки ДЗ (преподаватель / админ / куратор).

alter table public.homework_assignments
  add column if not exists reviewed_by_telegram_id bigint,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewer_role text
    check (reviewer_role is null or reviewer_role in ('teacher', 'admin', 'curator'));

create index if not exists homework_assignments_review_status_submitted_idx
  on public.homework_assignments (review_status, submitted_at desc nulls last);
