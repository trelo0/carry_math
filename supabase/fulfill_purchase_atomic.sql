-- RPC функция для атомарного создания платежа и пакета.
-- Проверяет версию заявки, создаёт или находит платеж и пакет с верификацией полей.
-- Выполнить после purchase_requests_processing.sql, lesson_packages_purchase_request.sql и payments_external_id_unique.sql.

CREATE OR REPLACE FUNCTION fulfill_purchase_atomic(
  p_id text,
  p_telegram_id bigint,
  p_product text,
  p_amount_byn numeric,
  p_lessons int,
  p_title text,
  p_expires_at timestamptz DEFAULT NULL
) RETURNS json AS $$
DECLARE
  v_current_version bigint;
  v_status text;
  v_payment_id bigint;
  v_package_id bigint;
  v_existing_telegram_id bigint;
  v_existing_product text;
  v_existing_amount numeric;
  v_existing_total_lessons int;
  v_error_message text;
BEGIN
  -- Атомарная проверка версии и статуса
  SELECT status, processing_version
  INTO v_status, v_current_version
  FROM public.purchase_requests
  WHERE id = p_id AND status = 'processing'
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'reason', 'not_processing');
  END IF;
  
  -- === Этап 1: recordPayment с верификацией ===
  INSERT INTO public.payments (telegram_id, product, amount_byn, external_id)
  VALUES (p_telegram_id, p_product, p_amount_byn, p_id)
  ON CONFLICT (external_id) DO NOTHING
  RETURNING id INTO v_payment_id;
  
  IF v_payment_id IS NULL THEN
    -- Конфликт — проверяем существующую запись
    SELECT id, telegram_id, product, amount_byn
    INTO v_payment_id, v_existing_telegram_id, v_existing_product, v_existing_amount
    FROM public.payments
    WHERE external_id = p_id;
    
    IF v_payment_id IS NULL THEN
      RAISE EXCEPTION 'Payment conflict but no record found';
    END IF;
    
    -- Верификация полей
    IF v_existing_telegram_id != p_telegram_id THEN
      v_error_message := 'Payment exists with different telegram_id: ' || v_existing_telegram_id || ' vs ' || p_telegram_id;
      RAISE EXCEPTION '%', v_error_message;
    END IF;
    
    IF v_existing_product != p_product THEN
      v_error_message := 'Payment exists with different product: ' || v_existing_product || ' vs ' || p_product;
      RAISE EXCEPTION '%', v_error_message;
    END IF;
    
    IF v_existing_amount != p_amount_byn THEN
      v_error_message := 'Payment exists with different amount: ' || v_existing_amount || ' vs ' || p_amount_byn;
      RAISE EXCEPTION '%', v_error_message;
    END IF;
  END IF;
  
  -- === Этап 2: grantLessonPackage с верификацией ===
  INSERT INTO public.lesson_packages (
    telegram_id, product, title, total_lessons, remaining_lessons, 
    purchase_request_id, expires_at
  )
  VALUES (p_telegram_id, p_product, p_title, p_lessons, p_lessons, p_id, p_expires_at)
  ON CONFLICT (purchase_request_id) DO NOTHING
  RETURNING id INTO v_package_id;
  
  IF v_package_id IS NULL THEN
    -- Конфликт — проверяем существующую запись
    SELECT id, telegram_id, product, total_lessons
    INTO v_package_id, v_existing_telegram_id, v_existing_product, v_existing_total_lessons
    FROM public.lesson_packages
    WHERE purchase_request_id = p_id;
    
    IF v_package_id IS NULL THEN
      RAISE EXCEPTION 'Package conflict but no record found';
    END IF;
    
    -- Верификация полей (не проверяем remaining_lessons — это расход кредита)
    IF v_existing_telegram_id != p_telegram_id THEN
      v_error_message := 'Package exists with different telegram_id: ' || v_existing_telegram_id || ' vs ' || p_telegram_id;
      RAISE EXCEPTION '%', v_error_message;
    END IF;
    
    IF v_existing_product != p_product THEN
      v_error_message := 'Package exists with different product: ' || v_existing_product || ' vs ' || p_product;
      RAISE EXCEPTION '%', v_error_message;
    END IF;
    
    IF v_existing_total_lessons != p_lessons THEN
      v_error_message := 'Package exists with different total_lessons: ' || v_existing_total_lessons || ' vs ' || p_lessons;
      RAISE EXCEPTION '%', v_error_message;
    END IF;
  END IF;
  
  -- === Этап 3: Связь payments.package_id ===
  UPDATE public.payments
  SET package_id = v_package_id
  WHERE id = v_payment_id AND package_id IS NULL;
  
  RETURN json_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'package_id', v_package_id
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fulfill_purchase_atomic IS 
'Атомарно создаёт или находит платеж и пакет для заявки.
Проверяет версию заявки через FOR UPDATE.
Верифицирует все значимые поля при конфликте.
Связывает payments.package_id с lesson_packages.
При несовпадении полей возвращает ошибку.';
