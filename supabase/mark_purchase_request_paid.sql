-- Оплата заказа без выдачи пакета (individual, group, trial). Курс — fulfill_purchase_full.

CREATE OR REPLACE FUNCTION public.mark_purchase_request_paid(
  p_id uuid,
  p_expected_version bigint,
  p_telegram_id bigint,
  p_product text,
  p_amount_byn numeric,
  p_bepaid_transaction_uid text DEFAULT NULL
) RETURNS json AS $$
DECLARE
  v_status text;
  v_current_version bigint;
  v_payment_id bigint;
  v_existing_telegram_id bigint;
  v_existing_product text;
  v_existing_amount numeric;
BEGIN
  SELECT status, processing_version
  INTO v_status, v_current_version
  FROM public.purchase_requests
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'reason', 'not_found');
  END IF;

  IF v_status IN ('paid', 'approved') THEN
    RETURN json_build_object('success', true, 'reason', 'already_paid');
  END IF;

  IF v_status = 'rejected' THEN
    RETURN json_build_object('success', false, 'reason', 'rejected');
  END IF;

  IF v_current_version != p_expected_version THEN
    RETURN json_build_object('success', false, 'reason', 'stale_version');
  END IF;

  IF v_status != 'processing' THEN
    RETURN json_build_object('success', false, 'reason', 'not_processing', 'status', v_status);
  END IF;

  INSERT INTO public.payments (telegram_id, product, amount_byn, external_id)
  VALUES (p_telegram_id, p_product, p_amount_byn, p_id::text)
  ON CONFLICT (external_id) DO NOTHING
  RETURNING id INTO v_payment_id;

  IF v_payment_id IS NULL THEN
    SELECT id, telegram_id, product, amount_byn
    INTO v_payment_id, v_existing_telegram_id, v_existing_product, v_existing_amount
    FROM public.payments
    WHERE external_id = p_id::text;

    IF v_payment_id IS NULL THEN
      RAISE EXCEPTION 'Payment conflict but no record found';
    END IF;

    IF v_existing_telegram_id != p_telegram_id
      OR v_existing_product != p_product
      OR v_existing_amount != p_amount_byn THEN
      RAISE EXCEPTION 'Payment exists with different fields';
    END IF;
  END IF;

  UPDATE public.purchase_requests
  SET
    status = 'paid',
    resolved_at = now(),
    bepaid_transaction_uid = COALESCE(p_bepaid_transaction_uid, bepaid_transaction_uid)
  WHERE id = p_id;

  RETURN json_build_object('success', true, 'payment_id', v_payment_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.mark_purchase_request_paid IS
'Фиксирует успешную оплату заказа (ind/group/trial) без создания lesson_packages.';
