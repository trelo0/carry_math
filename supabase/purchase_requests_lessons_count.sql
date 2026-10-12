-- Фиксирует число занятий на момент создания заявки (для webhook без пересчёта из Sanity).
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS lessons_count int;

COMMENT ON COLUMN public.purchase_requests.lessons_count IS
'Количество занятий курса на момент создания заявки. Webhook использует это значение при fulfill.';
