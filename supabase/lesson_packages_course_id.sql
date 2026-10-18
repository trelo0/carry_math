-- Пакеты курса привязаны к course_id (мультикурс).
-- После course_staff_multicourse.sql и lesson_packages_purchase_request.sql.

alter table public.lesson_packages
  add column if not exists course_id bigint references public.courses (id) on delete set null;

create index if not exists lesson_packages_course_student_idx
  on public.lesson_packages (telegram_id, product, course_id, status)
  where product = 'course';

-- Backfill из заявки на оплату
update public.lesson_packages lp
set course_id = c.id
from public.purchase_requests pr
join public.courses c on c.slug = pr.course_slug
where lp.purchase_request_id = pr.id
  and lp.product = 'course'
  and lp.course_id is null
  and pr.course_slug is not null;
