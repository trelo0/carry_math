-- История версий сдачи ДЗ (перед доработкой / при повторной сдаче).

create table if not exists public.homework_submission_versions (
  id bigint generated always as identity primary key,
  homework_id bigint not null references public.homework_assignments (id) on delete cascade,
  version_no smallint not null,
  submission_text text,
  submission_files jsonb not null default '[]'::jsonb,
  submitted_at timestamptz,
  outcome text not null check (outcome in ('revision', 'resubmit', 'approved')),
  reviewer_telegram_id bigint,
  reviewer_role text,
  reviewer_comment text,
  created_at timestamptz not null default now()
);

create index if not exists homework_submission_versions_hw_idx
  on public.homework_submission_versions (homework_id, version_no desc);

alter table public.homework_submission_versions enable row level security;
