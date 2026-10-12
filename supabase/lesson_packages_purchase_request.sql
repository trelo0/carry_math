-- Миграция для связи lesson_packages с purchase_requests.
-- Добавляет purchase_request_id (uuid) и уникальный индекс.
-- Выполнить в Supabase Dashboard → SQL Editor.

-- 1. Добавляем поле purchase_request_id (uuid для соответствия purchase_requests.id)
ALTER TABLE public.lesson_packages
  ADD COLUMN IF NOT EXISTS purchase_request_id uuid;

-- 2. Добавляем внешний ключ (опционально, NULL допустим) — условно
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lesson_packages_purchase_request_fkey'
    AND conrelid = 'public.lesson_packages'::regclass
  ) THEN
    ALTER TABLE public.lesson_packages
      ADD CONSTRAINT lesson_packages_purchase_request_fkey
      FOREIGN KEY (purchase_request_id)
      REFERENCES public.purchase_requests(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Создаём уникальный индекс (поддерживает множественные NULL)
CREATE UNIQUE INDEX IF NOT EXISTS lesson_packages_purchase_request_unique
ON public.lesson_packages (purchase_request_id);

COMMENT ON COLUMN public.lesson_packages.purchase_request_id IS
'Идентификатор заявки на покупку, связанной с этим пакетом. NULL для старых пакетов или ручного подтверждения.';

COMMENT ON INDEX lesson_packages_purchase_request_unique IS
'Гарантирует, что одна заявка создаёт не более одного пакета. Множественные NULL допустимы.';
