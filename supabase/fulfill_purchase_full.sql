-- RPC функция для атомарного завершения покупки.
DROP FUNCTION IF EXISTS public.fulfill_purchase_full(
  uuid, bigint, bigint, text, numeric, integer, text, timestamptz, bigint, text, bigint, bigint
);
-- Выполняет recordPayment, grantLessonPackage, grantAccess, course_enrollments в одной транзакции.
-- Сценарии курса (start_from_beginning, join_current) сохраняются через базовый enrollment.
-- Выполнить после purchase_requests_processing.sql, lesson_packages_purchase_request.sql и payments_external_id_unique.sql.

CREATE OR REPLACE FUNCTION fulfill_purchase_full(
  p_id uuid,
  p_expected_version bigint,
  p_telegram_id bigint,
  p_product text,
  p_amount_byn numeric,
  p_lessons int,
  p_title text,
  p_expires_at timestamptz DEFAULT NULL,
  p_course_id bigint DEFAULT NULL,
  p_scenario text DEFAULT NULL,
  p_start_module_id bigint DEFAULT NULL,
  p_start_lesson_id bigint DEFAULT NULL,
  p_bepaid_transaction_uid text DEFAULT NULL
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
  WHERE id = p_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'reason', 'not_found');
  END IF;
  
  -- Уже одобрена
  IF v_status = 'approved' THEN
    RETURN json_build_object('success', true, 'reason', 'already_approved');
  END IF;
  
  -- Версия изменилась
  IF v_current_version != p_expected_version THEN
    RETURN json_build_object('success', false, 'reason', 'stale_version');
  END IF;
  
  -- Статус не processing
  IF v_status != 'processing' THEN
    RETURN json_build_object('success', false, 'reason', 'not_processing', 'status', v_status);
  END IF;
  
  -- === Этап 1: recordPayment с верификацией ===
  INSERT INTO public.payments (telegram_id, product, amount_byn, external_id)
  VALUES (p_telegram_id, p_product, p_amount_byn, p_id::text)
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
    purchase_request_id, expires_at, course_id
  )
  VALUES (
    p_telegram_id, p_product, p_title, p_lessons, p_lessons, p_id, p_expires_at,
    CASE WHEN p_product = 'course' THEN p_course_id ELSE NULL END
  )
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
  
  -- === Этап 4: grantAccess (upsert на telegram_id, product) ===
  INSERT INTO public.user_accesses (telegram_id, product, status, started_at, expires_at, updated_at)
  VALUES (p_telegram_id, p_product, 'active', now(), p_expires_at, now())
  ON CONFLICT (telegram_id, product) DO UPDATE SET
    status = 'active',
    started_at = EXCLUDED.started_at,
    expires_at = COALESCE(EXCLUDED.expires_at, p_expires_at),
    updated_at = now();
  
  -- === Этап 5: course_enrollments (сценарные поля атомарно) ===
  IF p_course_id IS NOT NULL THEN
    INSERT INTO public.course_enrollments (
      telegram_id, course_id, status, started_at, updated_at,
      purchase_scenario, start_module_id, start_lesson_id
    )
    VALUES (
      p_telegram_id, p_course_id, 'active', now(), now(),
      p_scenario, p_start_module_id, p_start_lesson_id
    )
    ON CONFLICT (telegram_id, course_id) DO UPDATE SET
      status = 'active',
      updated_at = now(),
      purchase_scenario = CASE WHEN p_scenario IS NOT NULL THEN p_scenario ELSE public.course_enrollments.purchase_scenario END,
      start_module_id = CASE WHEN p_scenario IS NOT NULL THEN p_start_module_id ELSE public.course_enrollments.start_module_id END,
      start_lesson_id = CASE WHEN p_scenario IS NOT NULL THEN p_start_lesson_id ELSE public.course_enrollments.start_lesson_id END;
  END IF;
  
  -- === Этап 6: UID bePaid и утверждение заявки ===
  UPDATE public.purchase_requests
  SET
    status = 'approved',
    resolved_at = now(),
    bepaid_transaction_uid = COALESCE(p_bepaid_transaction_uid, bepaid_transaction_uid)
  WHERE id = p_id;
  
  RETURN json_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'package_id', v_package_id
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fulfill_purchase_full IS 
'Атомарно завершает покупку: создаёт/находит платёж и пакет, выдаёт доступ, зачисление на курс со сценариями.
Проверяет версию заявки через FOR UPDATE.
Верифицирует все значимые поля при конфликте.
Связывает payments.package_id с lesson_packages.
Сценарии курса (start_from_beginning, join_current) сохраняются атомарно с зачислением.
При несовпадении полей возвращает ошибку.
Переводит заявку в approved внутри транзакции.';
