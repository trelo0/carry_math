# Тестовый сценарий для проверки конкурентной обработки bePaid-покупок

## Предварительные требования

1. Миграции должны быть применены в Supabase:
   - purchase_requests_processing.sql
   - lesson_packages_purchase_request.sql
   - payments_external_id_unique.sql
   - fulfill_purchase_atomic.sql

2. Переменные окружения настроены:
   - BEPAY_SHOP_ID
   - BEPAY_SECRET_KEY
   - BEPAY_RSA_PUBLIC_KEY

3. Webhook bePaid настроен на `/api/payments/webhook`

## Сценарий 1: Конкурентные webhook

**Цель:** Проверить что два одновременных webhook не создают дублирующие платежи и пакеты

**Шаги:**
1. Создать purchase_request со статусом pending
2. Отправить два webhook одновременно (используя curl/Postman)
3. Проверить что:
   - Только один webhook вернёт success
   - Второй вернёт retry_later или alreadyProcessed
   - В payments одна запись с external_id = purchase_request.id
   - В lesson_packages одна запись с purchase_request_id = purchase_request.id
   - Статус заявки = approved

**Проверка SQL:**
```sql
SELECT COUNT(*) FROM payments WHERE external_id = '<uuid>';
SELECT COUNT(*) FROM lesson_packages WHERE purchase_request_id = '<uuid>';
SELECT status FROM purchase_requests WHERE id = '<uuid>';
```

## Сценарий 2: Partial failure после atomic RPC

**Цель:** Проверить восстановление после частичного сбоя

**Шаги:**
1. Создать purchase_request
2. Временно модифицировать webhook: после вызова fulfill_purchase_atomic добавить искусственную ошибку
3. Отправить webhook
4. Проверить что:
   - payments создана
   - lesson_packages создана
   - Статус заявки = processing (из-за ошибки)
5. Исправить webhook
6. Отправить повторный webhook
7. Проверить что:
   - Повторный webhook в recovery mode
   - Payments не дублируется
   - Lesson_packages не дублируется
   - Статус заявки = approved

## Сценарий 3: Конфликт external_id с разными параметрами

**Цель:** Проверить что при конфликте с несовпадающими параметрами происходит ошибка

**Шаги:**
1. Создать purchase_request с telegram_id = 123, amount = 50
2. Вручную создать payment с тем же external_id но telegram_id = 456
3. Отправить webhook
4. Проверить что:
   - Webhook возвращает ошибку
   - Платёж не создаётся
   - Статус заявки = rejected

## Сценарий 4: Processing timeout

**Цель:** Проверить recovery mode при истечении processing timeout

**Шаги:**
1. Создать purchase_request
2. Вручную установить status = processing, processing_updated_at = now() - 20 минут
3. Вручную создать payment с этим external_id
4. Отправить webhook
5. Проверить что:
   - acquire_processing_lock возвращает recovery mode
   - fulfill_purchase_atomic находит существующий payment
   - Статус заявки = approved

## Сценарий 5: Повторная покупка

**Цель:** Проверить что повторная покупка с новым purchase_request_id работает

**Шаги:**
1. Создать purchase_request #1, выполнить оплату
2. Создать purchase_request #2 для того же пользователя и продукта
3. Отправить webhook для #2
4. Проверить что:
   - Создаётся новый payment
   - Создаётся новый lesson_packages
   - Старый пакет не изменяется
   - Оба пакета связаны с разными purchase_request_id

## Диагностика SQL для выполнения перед тестами

```sql
-- Проверить тип purchase_requests.id
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'purchase_requests' AND column_name = 'id';

-- Проверить существующие UNIQUE constraints
SELECT constraint_name, column_name
FROM information_schema.key_column_usage
WHERE table_name IN ('accesses', 'course_enrollments', 'mentor_assignments', 'course_lesson_student_progress');

-- Проверить дубликаты external_id
SELECT external_id, count(*) 
FROM public.payments 
WHERE external_id IS NOT NULL 
GROUP BY external_id 
HAVING count(*) > 1;
```
