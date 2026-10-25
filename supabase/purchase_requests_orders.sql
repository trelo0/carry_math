-- Заказы из заявок: пробное / пакет, оплата без авто-выдачи ind/group/trial.

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads (id) ON DELETE SET NULL;

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS order_kind text NOT NULL DEFAULT 'package'
  CHECK (order_kind IN ('package', 'trial'));

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS lesson_format text
  CHECK (lesson_format IS NULL OR lesson_format IN ('individual', 'group'));

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS group_id bigint REFERENCES public."groups" (id) ON DELETE SET NULL;

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS service_description text;

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS teacher_telegram_id bigint REFERENCES public.bot_members (telegram_id) ON DELETE SET NULL;

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS lessons_delivered int NOT NULL DEFAULT 0;

ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_status_check;

ALTER TABLE public.purchase_requests
  ADD CONSTRAINT purchase_requests_status_check
  CHECK (status IN ('pending', 'processing', 'paid', 'approved', 'rejected'));

ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_product_check;

ALTER TABLE public.purchase_requests
  ADD CONSTRAINT purchase_requests_product_check
  CHECK (product IN ('course', 'individual', 'group', 'trial'));

CREATE INDEX IF NOT EXISTS purchase_requests_lead_id_idx
  ON public.purchase_requests (lead_id)
  WHERE lead_id IS NOT NULL;

ALTER TABLE public.scheduled_lessons
  ADD COLUMN IF NOT EXISTS purchase_request_id uuid REFERENCES public.purchase_requests (id) ON DELETE SET NULL;

ALTER TABLE public.scheduled_lessons
  ADD COLUMN IF NOT EXISTS trial_admin_notified_at timestamptz;

COMMENT ON COLUMN public.purchase_requests.lessons_delivered IS
'Сколько занятий из оплаченного пакета уже выдано в lesson_packages (ручная выдача).';
