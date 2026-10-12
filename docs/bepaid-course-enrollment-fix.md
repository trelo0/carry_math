# Исправление курсового зачисления для bePaid-покупок

## Изменённые файлы

**SQL миграции:**
1. `supabase/lesson_packages_purchase_request.sql` — создан
2. `supabase/payments_external_id_unique.sql` — создан
3. `supabase/purchase_requests_processing.sql` — обновлён
4. `supabase/fulfill_purchase_full.sql` — обновлён (добавлено course_enrollments)
5. `supabase/course_purchase_scenarios.sql` — нужно добавить в список (существует, но не применён)

**TypeScript:**
1. `src/lib/bot/purchase-requests.ts` — типы обновлены
2. `src/lib/bot/packages.ts` — grantLessonPackage с purchaseRequestId
3. `src/lib/bot/purchase-fulfillment.ts` — типы обновлены
4. `src/app/api/payments/webhook/route.ts` — обновлён (courseId + scenario поля)

## Изменения в fulfill_purchase_full.sql

**Добавлено:**
- Параметр `p_course_id bigint DEFAULT NULL`
- Этап 5: course_enrollments INSERT ON CONFLICT (telegram_id, course_id)
- Базовое зачисление внутри транзакции

**Не включено в RPC:**
- purchase_scenario, start_module_id, start_lesson_id — обновляются в TypeScript после RPC
- Это сохраняет существующую логику сценариев

## Изменения в webhook/route.ts

**Добавлено:**
- Получение courseId через resolveCourseIdForContent
- Обновление purchase_scenario, start_module_id, start_lesson_id после успешной RPC
- Обработка errors (не критично)

## Порядок миграций

1. lesson_packages_purchase_request.sql
2. payments_external_id_unique.sql (после проверки дубликатов)
3. purchase_requests_processing.sql
4. course_purchase_scenarios.sql (существует, но нужно проверить применение)
5. fulfill_purchase_full.sql

## Результаты тестов

✅ TypeScript — ошибка исправлена (undefined вместо null)

## Оставшиеся проверки перед production

1. Проверить дубликаты payments.external_id
2. Проверить применена ли course_purchase_scenarios.sql
3. Применить 5 миграций в указанном порядке
4. Протестировать RPC функции в Supabase
5. Протестировать покупку курса с обоими сценариями
6. Нагрузочное тестирование concurrent webhook

❌ **НЕ ГОТОВА к реальным платежам** — миграции не применены
