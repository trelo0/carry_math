-- Миграция для защиты от дублирования платежей bePaid.
-- Выполнить один раз: Supabase Dashboard → SQL Editor → Run.

-- 1. Проверка существующих дубликатов bepaid_transaction_uid перед добавлением UNIQUE constraint
DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT bepaid_transaction_uid, count(*)
    FROM public.purchase_requests
    WHERE bepaid_transaction_uid IS NOT NULL
    GROUP BY bepaid_transaction_uid
    HAVING count(*) > 1
  ) dup;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Найдены дубликаты bepaid_transaction_uid (% шт). Сначала устраните дубликаты вручную.', duplicate_count;
  END IF;
END $$;

-- 2. Добавление UNIQUE constraint на bepaid_transaction_uid
ALTER TABLE public.purchase_requests
  ADD CONSTRAINT purchase_requests_bepaid_uid_unique UNIQUE (bepaid_transaction_uid);

-- 3. Создание функции для атомарного обновления статуса заявки
CREATE OR REPLACE FUNCTION mark_purchase_request_resolved(
  p_id text,
  p_status text,
  p_resolved_by bigint DEFAULT NULL
) RETURNS boolean AS $$
DECLARE
  v_updated boolean;
BEGIN
  UPDATE public.purchase_requests
  SET 
    status = p_status,
    resolved_at = now(),
    resolved_by = p_resolved_by
  WHERE id = p_id AND status = 'pending'
  RETURNING id INTO v_updated;
  
  RETURN v_updated IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- 4. Комментарий к использованию
COMMENT ON FUNCTION mark_purchase_request_resolved IS 
'Атомарно обновляет статус заявки с pending на указанный статус. 
Возвращает true, если обновление выполнено (заявка была pending), 
false - если заявка уже обработана другим процессом. Используется для защиты от конкурентных webhook.';
