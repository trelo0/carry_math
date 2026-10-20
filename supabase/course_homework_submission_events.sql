-- История сдач ДЗ онлайн-курса (отправки, доработки, одобрения).

create table if not exists public.course_homework_submission_events (
  id bigint generated always as identity primary key,
  telegram_id bigint not null,
  sanity_lesson_id text not null,
  course_id bigint references public.courses (id) on delete set null,
  event_type text not null check (
    event_type in ('submitted', 'revision_requested', 'approved')
  ),
  sequence_no smallint not null,
  submission_note text,
  submission_file_url text,
  reviewer_telegram_id bigint,
  reviewer_role text,
  reviewer_comment text,
  created_at timestamptz not null default now()
);

create unique index if not exists course_hw_sub_events_seq_uidx
  on public.course_homework_submission_events (telegram_id, sanity_lesson_id, sequence_no);

create index if not exists course_hw_sub_events_lesson_idx
  on public.course_homework_submission_events (telegram_id, sanity_lesson_id, created_at);

alter table public.course_homework_submission_events enable row level security;
