-- SQL-функция для атомарного списания кредита из курсового пакета.
-- Защищает от race condition при параллельных запросах открытия уроков.
-- Выполнить после применения purchase_requests_bepaid_v2.sql.

CREATE OR REPLACE FUNCTION deduct_course_package_credit(
  p_telegram_id bigint,
  p_package_id bigint DEFAULT NULL
) RETURNS integer AS $$
DECLARE
  v_package_id integer;
  v_remaining integer;
BEGIN
  -- Если указан конкретный пакет, проверяем его
  IF p_package_id IS NOT NULL THEN
    SELECT id, remaining_lessons INTO v_package_id, v_remaining
    FROM public.lesson_packages
    WHERE id = p_package_id
      AND telegram_id = p_telegram_id
      AND product = 'course'
      AND status = 'active'
      AND remaining_lessons > 0
    FOR UPDATE;

    IF v_package_id IS NULL THEN
      RETURN NULL; -- Пакет не найден или без кредитов
    END IF;

    UPDATE public.lesson_packages
    SET 
      remaining_lessons = remaining_lessons - 1,
      used_lessons = used_lessons + 1,
      updated_at = now()
    WHERE id = v_package_id;

    RETURN v_package_id;
  END IF;

  -- Иначе находим первый доступный пакет
  SELECT id, remaining_lessons INTO v_package_id, v_remaining
  FROM public.lesson_packages
  WHERE telegram_id = p_telegram_id
    AND product = 'course'
    AND status = 'active'
    AND remaining_lessons > 0
  ORDER BY purchased_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_package_id IS NULL THEN
    RETURN NULL; -- Нет доступных пакетов
  END IF;

  UPDATE public.lesson_packages
  SET 
    remaining_lessons = remaining_lessons - 1,
    used_lessons = used_lessons + 1,
    updated_at = now()
  WHERE id = v_package_id;

  RETURN v_package_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION deduct_course_package_credit IS 
'Атомарно списывает один кредит из курсового пакета.
Возвращает ID пакета или NULL, если кредитов нет.
Использует FOR UPDATE для блокировки строки и защиты от race condition.';
