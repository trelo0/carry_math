-- Миграция для уникальности payments.external_id.
-- Создаёт обычный уникальный индекс (поддерживает множественные NULL).
-- Выполнить в Supabase Dashboard → SQL Editor ПОСЛЕ проверки дубликатов.

-- ПРЕДВАРИТЕЛЬНАЯ ПРОВЕРКА ДУБЛИКАТОВ:
-- Раскомментируйте и выполните перед созданием индекса:
/*
SELECT external_id, count(*)
FROM public.payments
WHERE external_id IS NOT NULL
GROUP BY external_id
HAVING count(*) > 1;
*/

-- Если дубликаты найдены — исправьте вручную, затем создайте индекс:

-- Удаляем частичный индекс, если существует
DROP INDEX IF EXISTS public.payments_external_id_unique;

-- Создаём обычный уникальный индекс (поддерживает множественные NULL)
CREATE UNIQUE INDEX payments_external_id_unique
ON public.payments (external_id);

COMMENT ON INDEX payments_external_id_unique IS
'Гарантирует уникальность external_id для платежей. Множественные NULL допустимы для legacy платежей.';
