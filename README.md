# Online Math (Next.js + Sanity)

## Sanity Studio

Studio доступна по пути:

- `https://<your-domain>/studio`
- Локально: `http://localhost:3000/studio`

## Инструкция: доступ для стороннего администратора Sanity

Цель: дать человеку возможность редактировать контент сайта (тексты/карточки/настройки), **не давая доступ к репозиторию, Vercel и секретам**.

### 1) Приглашение пользователя в Sanity

1) Открой Sanity Manage:
   - `https://sanity.io/manage`
2) Выбери проект Sanity (Project ID) и нужный dataset.
3) Перейди в:
   - **Members** / **Team** (раздел с участниками)
4) Нажми **Invite** и введи email администратора.

### 2) Роли (что выдавать)

Рекомендуемая схема:

- **Editor / Author**: если админ должен только редактировать контент.
- **Admin**: только если админ должен управлять схемами/датасетами/участниками.

Минимально безопасный вариант для “контент-менеджера”:

- доступ к проекту + роль **Editor/Author**.

### 3) Как администратору зайти и редактировать контент

1) Администратор открывает Studio по ссылке:
   - `https://<your-domain>/studio`
2) Логинится через Sanity (по приглашению).
3) Редактирует документы:
   - `Home Page` (главная)
   - `Teachers`, `Courses`, `Method Steps`, `Process Steps`, `Problems`
   - `Site Settings` (заголовок сайта, футер и т.д.)

### 4) Публикация изменений

- После редактирования нужно нажать **Publish**.
- Сайт обновляется через Next.js revalidation (webhook) либо через TTL revalidate.

### 5) Preview (черновики)

Preview нужен только если вы хотите видеть **draft**-контент на сайте до публикации.

- Включение: `/api/draft-mode/enable?secret=<SANITY_PREVIEW_SECRET>&redirect=/`
- Выключение: `/api/draft-mode/disable?redirect=/`

Администратору **не нужно** знать секрет. Достаточно дать ему готовую ссылку (если preview вообще используется).

### 6) Что администратору НЕ выдавать

Никогда не передавать администратору:

- доступ к GitHub репозиторию (если не требуется)
- доступ к Vercel проекту
- значения переменных окружения (env), токены и секреты:
  - `SANITY_API_READ_TOKEN`
  - `SANITY_PREVIEW_SECRET`
  - `SANITY_REVALIDATE_SECRET`
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`

## Локальный запуск

## Переменные окружения (до Vercel)

В репозитории есть файл `env.example` (именно так, т.к. `.env*` игнорируются `.gitignore`).

1) Скопируй `env.example` в `.env.local`
2) Заполни значения

Минимально необходимые для Sanity:

- `NEXT_PUBLIC_SANITY_PROJECT_ID`
- `NEXT_PUBLIC_SANITY_DATASET`

Опционально:

- `NEXT_PUBLIC_SITE_URL` (появится позже, когда будет домен)
- `SANITY_API_READ_TOKEN` + `SANITY_PREVIEW_SECRET` (только если нужен draft preview)
- `SANITY_REVALIDATE_SECRET` (рекомендуется для продакшена, для webhook revalidate)
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (если нужен Telegram для заявок)

```bash
npm install
npm run dev
```
