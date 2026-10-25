-- Мультикурс: списание кредита с учётом course_id.
-- Безопасно для прода: не трогает Sanity, progress, sessions — только функция RPC.
-- Legacy: lesson_packages.course_id IS NULL (старый основной курс) — см. комментарии в теле.
-- Порядок: lesson_packages_course_id.sql → course_package_deduct_credit.sql → этот файл.

DROP FUNCTION IF EXISTS deduct_course_package_credit(bigint, bigint);

CREATE OR REPLACE FUNCTION deduct_course_package_credit(
  p_telegram_id bigint,
  p_package_id bigint DEFAULT NULL,
  p_course_id bigint DEFAULT NULL
) RETURNS integer AS $$
DECLARE
  v_package_id integer;
  v_remaining integer;
BEGIN
  IF p_package_id IS NOT NULL THEN
    SELECT id, remaining_lessons INTO v_package_id, v_remaining
    FROM public.lesson_packages
    WHERE id = p_package_id
      AND telegram_id = p_telegram_id
      AND product = 'course'
      AND status = 'active'
      AND remaining_lessons > 0
      AND (
        p_course_id IS NULL
        OR course_id = p_course_id
        OR course_id IS NULL
      )
    FOR UPDATE;

    IF v_package_id IS NULL THEN
      RETURN NULL;
    END IF;

    UPDATE public.lesson_packages
    SET
      remaining_lessons = remaining_lessons - 1,
      used_lessons = used_lessons + 1,
      updated_at = now()
    WHERE id = v_package_id;

    RETURN v_package_id;
  END IF;

  SELECT id, remaining_lessons INTO v_package_id, v_remaining
  FROM public.lesson_packages
  WHERE telegram_id = p_telegram_id
    AND product = 'course'
    AND status = 'active'
    AND remaining_lessons > 0
    AND (
      p_course_id IS NULL
      OR course_id = p_course_id
      OR (
        course_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.lesson_packages lp2
          WHERE lp2.telegram_id = p_telegram_id
            AND lp2.product = 'course'
            AND lp2.status = 'active'
            AND lp2.remaining_lessons > 0
            AND lp2.course_id = p_course_id
        )
      )
    )
  ORDER BY purchased_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_package_id IS NULL THEN
    RETURN NULL;
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

COMMENT ON FUNCTION deduct_course_package_credit(bigint, bigint, bigint) IS
'Списание кредита курсового пакета; p_course_id изолирует курсы; legacy NULL course_id сохранён.';
