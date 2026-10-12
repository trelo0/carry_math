-- Миграция для защиты от конкурентной обработки bePaid-покупок.
-- Добавляет status 'processing', processing_version и processing_updated_at в purchase_requests.
-- Выполнить в Supabase Dashboard → SQL Editor.

-- 1. Добавляем поле processing_version
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS processing_version bigint NOT NULL DEFAULT 0;

-- 2. Добавляем поле processing_updated_at
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS processing_updated_at timestamptz;

-- 3. Обновляем check constraint для status (добавляем 'processing')
ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_status_check;

ALTER TABLE public.purchase_requests
  ADD CONSTRAINT purchase_requests_status_check
  CHECK (status IN ('pending', 'processing', 'approved', 'rejected'));

-- 4. RPC функция для захвата заявки
CREATE OR REPLACE FUNCTION acquire_processing_lock(p_id uuid)
RETURNS json AS $$
DECLARE
  v_current_version bigint;
  v_status text;
  v_processing_at timestamptz;
  v_payment_exists boolean;
  v_bepaid_uid_exists boolean;
  v_new_version bigint;
BEGIN
  -- Захват строки FOR UPDATE
  SELECT status, processing_version, processing_updated_at 
  INTO v_status, v_current_version, v_processing_at
  FROM public.purchase_requests
  WHERE id = p_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'reason', 'not_found');
  END IF;
  
  -- Финальные статусы нельзя менять
  IF v_status IN ('approved', 'rejected') THEN
    RETURN json_build_object('success', false, 'reason', 'finalized', 'status', v_status);
  END IF;
  
  -- Проверяем существование платежа
  SELECT EXISTS(
    SELECT 1 FROM public.payments 
    WHERE external_id = p_id::text
  ) INTO v_payment_exists;
  
  -- Проверяем наличие bepaid_transaction_uid
  SELECT EXISTS(
    SELECT 1 FROM public.purchase_requests
    WHERE id = p_id AND bepaid_transaction_uid IS NOT NULL
  ) INTO v_bepaid_uid_exists;
  
  -- Если processing и не истёк → активная обработка
  IF v_status = 'processing' AND v_processing_at > now() - interval '15 minutes' THEN
    RETURN json_build_object('success', false, 'reason', 'already_processing', 'version', v_current_version);
  END IF;
  
  -- Если processing истёк → решение на основе наличия платежа
  IF v_status = 'processing' AND (v_processing_at IS NULL OR v_processing_at <= now() - interval '15 minutes') THEN
    IF v_payment_exists THEN
      -- Платёж есть → режим восстановления, инкрементируем версию
      v_new_version := COALESCE(v_current_version, 0) + 1;
      UPDATE public.purchase_requests
      SET processing_version = v_new_version, processing_updated_at = now()
      WHERE id = p_id;
      RETURN json_build_object('success', true, 'mode', 'recovery', 'version', v_new_version);
    ELSIF v_bepaid_uid_exists THEN
      -- UID есть, платежа нет — recovery (webhook сверяет статус с bePaid до fulfill)
      v_new_version := COALESCE(v_current_version, 0) + 1;
      UPDATE public.purchase_requests
      SET processing_version = v_new_version, processing_updated_at = now()
      WHERE id = p_id;
      RETURN json_build_object('success', true, 'mode', 'recovery', 'version', v_new_version);
    ELSE
      -- Ни платежа ни UID нет → безопасно вернуть в pending
      UPDATE public.purchase_requests
      SET
        status = 'pending',
        processing_version = 0,
        processing_updated_at = NULL,
        bepaid_transaction_uid = NULL
      WHERE id = p_id;
      RETURN json_build_object('success', false, 'reason', 'reset_to_pending');
    END IF;
  END IF;
  
  -- Захват если pending
  IF v_status = 'pending' THEN
    v_new_version := COALESCE(v_current_version, 0) + 1;
    UPDATE public.purchase_requests
    SET status = 'processing', processing_version = v_new_version, processing_updated_at = now()
    WHERE id = p_id AND status = 'pending';
    
    IF FOUND THEN
      RETURN json_build_object('success', true, 'mode', 'acquired', 'version', v_new_version);
    END IF;
  END IF;
  
  RETURN json_build_object('success', false, 'reason', 'not_pending');
END;
$$ LANGUAGE plpgsql;

-- 5. RPC функция для завершения обработки
-- Примечание: сейчас не используется в коде, оставлена для будущего использования
CREATE OR REPLACE FUNCTION release_processing_lock(p_id uuid, p_status text)
RETURNS boolean AS $$
BEGIN
  UPDATE public.purchase_requests
  SET status = p_status, processing_updated_at = NULL
  WHERE id = p_id AND status = 'processing';

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION acquire_processing_lock IS 
'Захватывает заявку для обработки. Возвращает json с success, mode (acquired/recovery), version.
Защищает от конкурентной обработки через FOR UPDATE и проверку статуса.';

COMMENT ON FUNCTION release_processing_lock IS 
'Освобождает заявку после обработки. Устанавливает финальный статус и сбрасывает processing_version.';
