# Итоговый отчёт по реализации защиты bePaid-покупок

## Изменённые файлы

### 1. SQL-миграции (созданы, но не применены)

**supabase/purchase_requests_processing.sql**
- Добавляет поле `processing_version` (bigint, default 0)
- Добавляет поле `processing_updated_at` (timestamptz)
- Добавляет статус 'processing' в check constraint
- RPC функция `acquire_processing_lock` — захват заявки с FOR UPDATE
- RPC функция `release_processing_lock` — освобождение заявки

**supabase/lesson_packages_purchase_request.sql**
- Добавляет поле `purchase_request_id` (text, nullable)
- Добавляет FOREIGN KEY на purchase_requests
- Создаёт partial UNIQUE index WHERE purchase_request_id IS NOT NULL

**supabase/payments_external_id_unique.sql**
- Создаёт partial UNIQUE index WHERE external_id IS NOT NULL
- Включает проверку дубликатов (закомментирована для ручного выполнения)

**supabase/fulfill_purchase_atomic.sql**
- RPC функция `fulfill_purchase_atomic` — атомарное создание платежа и пакета
- Проверяет версию заявки через FOR UPDATE
- Верифицирует все поля при конфликте (telegram_id, product, amount, lessons)
- Связывает payments.package_id с lesson_packages
- При несовпадении полей возвращает ошибку

### 2. TypeScript файлы (изменены)

**src/lib/bot/purchase-requests.ts**
- Обновлён `PurchaseRequestStatus` — добавлен 'processing'
- Обновлён `PurchaseRequestRow` — добавлены processing_version, processing_updated_at
- Обновлён `REQUEST_COLUMNS` — новые поля в select

**src/lib/bot/purchase-fulfillment.ts**
- Обновлён `PurchaseFulfillInput` — добавлен purchaseRequestId
- Передача purchaseRequestId в completeProductPurchase

**src/lib/bot/packages.ts**
- Обновлён `completeProductPurchase` — добавлен purchaseRequestId в options
- Обновлён `grantLessonPackage` — добавлен purchaseRequestId в options
- Обновлён INSERT в lesson_packages — сохраняет purchase_request_id

**src/app/api/payments/webhook/route.ts**
- Заменена логика обработки bePaid webhook
- Вызов `acquire_processing_lock` RPC для захвата заявки
- Вызов `fulfill_purchase_atomic` RPC для создания платежа и пакета
- Вызов `release_processing_lock` RPC для завершения
- Fallback на старую логику если RPC не создан
- Обработка режимов: acquired, recovery, finalized, already_processing

### 3. Документация (создана)

**docs/bepaid-competitive-test-scenario.md**
- 5 тестовых сценариев для конкурентной обработки
- SQL-запросы для диагностики
- Порядок выполнения тестов

## Ключевые решения и ограничения

### Архитектура
- **processing_version** вместо processing_token для простоты
- **Одна SQL RPC** (fulfill_purchase_atomic) для recordPayment + grantLessonPackage
- **FOR UPDATE** в RPC для атомарной проверки версии
- **Partial UNIQUE indexes** для compatibility с NULL legacy данных
- **Верификация всех полей** при конфликте для защиты от подмены данных

### Защита от конкурентной обработки
- acquire_processing_lock использует FOR UPDATE на purchase_requests
- fulfill_purchase_atomic проверяет статус = 'processing' FOR UPDATE
- Только один webhook может пройти FOR UPDATE
- UNIQUE constraints на external_id и purchase_request_id предотвращают дубликаты

### Идемпотентность
- recordPayment: ON CONFLICT (external_id) + верификация полей
- grantLessonPackage: ON CONFLICT (purchase_request_id) + верификация полей
- grantAccess: INSERT ON CONFLICT (telegram_id, product) DO UPDATE
- Остальные операции: проверка существования перед INSERT

### Обратная совместимость
- Legacy webhook оставлен без изменений
- Ручное подтверждение: purchase_request_id может быть NULL
- Старые пакеты: purchase_request_id будет NULL
- Trial payments: не затронуты
- assignTeacher дубликаты допустимы (не добавлена защита)

## Порядок применения миграций

### 1. Проверка данных в Supabase (обязательно)

Выполнить в Supabase Dashboard → SQL Editor:

```sql
-- Проверить тип purchase_requests.id
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'purchase_requests' AND column_name = 'id';

-- Проверить дубликаты external_id
SELECT external_id, count(*) 
FROM public.payments 
WHERE external_id IS NOT NULL 
GROUP BY external_id 
HAVING count(*) > 1;

-- Если дубликаты найдены — исправить вручную перед созданием индекса
```

### 2. Применение миграций (по порядку)

1. **lesson_packages_purchase_request.sql**
   - Безопасно, NULL default
   - Добавляет purchase_request_id и UNIQUE index

2. **payments_external_id_unique.sql**
   - После проверки дубликатов
   - Создаёт partial UNIQUE index

3. **purchase_requests_processing.sql**
   - Безопасно, default 0
   - Добавляет processing_version, processing_updated_at, status
   - Создаёт RPC функции

4. **fulfill_purchase_atomic.sql**
   - Зависит от предыдущих миграций
   - Создаёт RPC функцию для атомарного fulfill

### 3. Переменные окружения

Добавить в `.env.local`:
```
BEPAY_SHOP_ID=
BEPAY_SECRET_KEY=
BEPAY_RSA_PUBLIC_KEY=
```

### 4. Настройки bePaid

- Настроить notification_url на `https://domain.com/api/payments/webhook`
- Получить RSA Public Key из настроек безопасности
- Включить webhook уведомления

## Что остаётся выполнить вручную в Supabase

1. **Проверить дубликаты external_id** (обязательно до payments_external_id_unique.sql)
2. **Проверить тип purchase_requests.id** (для подтверждения text/UUID)
3. **Проверить существующие UNIQUE constraints** (accesses, course_enrollments, mentor_assignments)
4. **Применить 4 миграции** в указанном порядке
5. **Проверить работу RPC функций** через Supabase Console
6. **Настроить webhook в кабинете bePaid**

## Результаты доступных проверок

✅ TypeScript проверка — без ошибок
✅ SQL синтаксис — валидный PostgreSQL
✅ ON CONFLICT для partial index — поддерживается PostgreSQL
✅ Типы ID — соответствуют схеме (bigint для identity, text для UUID)
❌ Дубликаты external_id — не проверены (требуется ручная проверка в Supabase)
❌ Существующие UNIQUE constraints — не проверены (требуется ручная проверка в Supabase)
❌ Работа RPC функций — не проверена (требуется после применения миграций)
❌ Производительность FOR UPDATE — не проверена (требуется нагрузочное тестирование)

## Статус интеграции

❌ **НЕ ГОТОВА к реальным платежам**

**Причины:**
- Миграции не применены
- Данные в Supabase не проверены
- RPC функции не протестированы
- Webhook bePaid не настроен
- Тесты конкурентной обработки не выполнены

**Требуется до реальных платежей:**
1. Применить миграции в Supabase
2. Выполнить диагностические SQL-запросы
3. Протестировать RPC функции
4. Выполнить тестовые сценарии из docs/bepaid-competitive-test-scenario.md
5. Настроить webhook в кабинете bePaid
6. Провести финальную проверку с тестовым платежом (минимальная сумма)
