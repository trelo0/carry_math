# Ind/group client bot (archived UI)

Включение: `CLIENT_LESSONS_BOT_UI_ENABLED = true` в `client-lessons-ui-flag.ts` + восстановить импорты в `client-flow.ts`, `webhook/route.ts`.

Модули (не удалены):

- `client-lead-flow.ts` — заявки ind/group
- `client-lessons-flow.ts`, `client-lessons-data.ts` — расписание, пакеты
- `client-lesson-homework-flow.ts` — ДЗ к scheduled_lessons
- `client-trial-pay-flow.ts` — оплата пробного (webhook оплат использует `processTrialPaymentWebhook`)
