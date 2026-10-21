-- «Карта просмотрена» отдельно на каждое зачисление (course_id).
-- Порядок: course_catalog.sql → course_map_viewed.sql → этот файл.

alter table public.course_enrollment_state
  add column if not exists map_viewed_at timestamptz;

comment on column public.course_enrollment_state.map_viewed_at is
  'Ученик нажал «Посмотреть карту» для этого course_id.';

-- Legacy: глобальный флаг профиля → все активные зачисления
update public.course_enrollment_state ces
set map_viewed_at = sp.course_map_viewed_at
from public.student_profiles sp
where sp.telegram_id = ces.telegram_id
  and sp.course_map_viewed_at is not null
  and ces.map_viewed_at is null;
