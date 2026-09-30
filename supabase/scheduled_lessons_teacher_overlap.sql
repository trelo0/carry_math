-- Пересечения по времени — только внутри одного преподавателя.
-- Групповые занятия: несколько строк на одно время (ученики группы), constraint не применяется.
-- Два индивидуальных scheduled у одного teacher в одном интервале — запрещено.

create extension if not exists btree_gist;

alter table public.scheduled_lessons
  drop constraint if exists scheduled_lessons_individual_no_overlap_per_teacher;

alter table public.scheduled_lessons
  add constraint scheduled_lessons_individual_no_overlap_per_teacher
  exclude using gist (
    teacher_telegram_id with =,
    tstzrange(
      starts_at,
      starts_at + make_interval(mins => duration_minutes),
      '[)'
    ) with &&
  )
  where (
    status = 'scheduled'
    and teacher_telegram_id is not null
    and kind = 'individual'
  );
