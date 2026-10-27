# Ручной тест: Staff DM Topics (check + admin)

**Перед тестом:** применить миграции `staff_dm_topics.sql`, `telegram_processed_updates.sql`, `staff_student_messages_admin_role.sql` на **staging** Supabase. Деплой webhook с новым кодом. Threaded Mode включён у бота.

**Флаг:** `STAFF_DM_TOPICS_ENABLED` не равен `0`/`false` (по умолчанию включено).

## Check

1. Тестовый check + тестовый ученик на одном курсе.
2. Ученик: вопрос по ДЗ / mentor flow → сообщение в **теме** check в ЛС с ботом (не General).
3. Check: «Связаться с учеником» → та же тема, без дубликата.
4. Check: ответ **в теме** → ученик получает текст в основном чате бота (без «Показать»).
5. Повторить update (не должно дублироваться при `update_id`).

## Admin

1. Ученик: «Связаться с администратором» → тема у каждого admin (env + role=admin).
2. Admin: `ah:msg:w` / «Связаться» → существующая тема.
3. Admin: ответ в теме → ученик в боте.

## Регрессия

- Teacher/curator: по-прежнему inline «Показать», без topics.
- ДЗ check (approve/reject) без изменений.
