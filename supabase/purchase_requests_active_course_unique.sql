-- Поля курса (если ещё не добавлены базовой миграцией purchase_requests.sql).
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS course_slug text;

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS scenario text;

-- Одна активная (pending/processing) заявка на курс+сценарий для ученика.
CREATE UNIQUE INDEX IF NOT EXISTS purchase_requests_active_course_unique_idx
  ON public.purchase_requests (
    telegram_id,
    product,
    COALESCE(course_slug, ''::text),
    COALESCE(scenario, ''::text)
  )
  WHERE status IN ('pending', 'processing') AND product = 'course';
