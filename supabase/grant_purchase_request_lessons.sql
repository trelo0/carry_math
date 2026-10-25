-- Ручная выдача занятий по оплаченному заказу пакета (полная или частичная).

CREATE OR REPLACE FUNCTION public.grant_purchase_request_lessons(
  p_request_id uuid,
  p_lessons int,
  p_admin_telegram_id bigint DEFAULT NULL,
  p_comment text DEFAULT NULL
) RETURNS json AS $$
DECLARE
  v_req record;
  v_grant int;
  v_remaining_to_deliver int;
  v_package_id bigint;
  v_title text;
BEGIN
  IF p_lessons IS NULL OR p_lessons <= 0 THEN
    RETURN json_build_object('success', false, 'reason', 'invalid_lessons');
  END IF;

  SELECT *
  INTO v_req
  FROM public.purchase_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'reason', 'not_found');
  END IF;

  IF v_req.order_kind != 'package' OR v_req.product NOT IN ('individual', 'group') THEN
    RETURN json_build_object('success', false, 'reason', 'not_lesson_package');
  END IF;

  IF v_req.status NOT IN ('paid', 'approved') THEN
    RETURN json_build_object('success', false, 'reason', 'not_paid', 'status', v_req.status);
  END IF;

  v_remaining_to_deliver := COALESCE(v_req.lessons_count, 0) - COALESCE(v_req.lessons_delivered, 0);
  IF v_remaining_to_deliver <= 0 THEN
    RETURN json_build_object('success', false, 'reason', 'nothing_left');
  END IF;

  v_grant := LEAST(p_lessons, v_remaining_to_deliver);
  v_title := COALESCE(v_req.title, v_req.product);

  INSERT INTO public.lesson_packages (
    telegram_id, product, title, total_lessons, remaining_lessons,
    purchase_request_id, expires_at, course_id
  )
  VALUES (
    v_req.telegram_id, v_req.product, v_title, v_grant, v_grant,
    p_request_id, NULL, NULL
  )
  ON CONFLICT (purchase_request_id) DO UPDATE SET
    total_lessons = public.lesson_packages.total_lessons + EXCLUDED.total_lessons,
    remaining_lessons = public.lesson_packages.remaining_lessons + EXCLUDED.remaining_lessons,
    updated_at = now()
  RETURNING id INTO v_package_id;

  IF v_package_id IS NULL THEN
    SELECT id INTO v_package_id FROM public.lesson_packages WHERE purchase_request_id = p_request_id;
  END IF;

  INSERT INTO public.user_accesses (telegram_id, product, status, started_at, updated_at)
  VALUES (v_req.telegram_id, v_req.product, 'active', now(), now())
  ON CONFLICT (telegram_id, product) DO UPDATE SET
    status = 'active',
    updated_at = now();

  UPDATE public.purchase_requests
  SET
    lessons_delivered = COALESCE(lessons_delivered, 0) + v_grant,
    status = CASE
      WHEN COALESCE(lessons_delivered, 0) + v_grant >= COALESCE(lessons_count, 0) THEN 'approved'
      ELSE status
    END,
    resolved_by = COALESCE(p_admin_telegram_id, resolved_by),
    resolved_at = CASE
      WHEN COALESCE(lessons_delivered, 0) + v_grant >= COALESCE(lessons_count, 0) THEN now()
      ELSE resolved_at
    END
  WHERE id = p_request_id;

  RETURN json_build_object(
    'success', true,
    'granted', v_grant,
    'package_id', v_package_id,
    'comment', p_comment
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.grant_purchase_request_lessons IS
'Выдаёт часть или весь оплаченный пакет ind/group; идемпотентно на уровне лимита lessons_count.';
