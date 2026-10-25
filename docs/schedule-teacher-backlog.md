# Backlog: экран расписания преподавателя

Модель продукта: ученики = `schedule_students` (блокнот), занятия без Telegram; курс — отдельно.

Приоритет: **P0** блокеры согласованности → **P1** ежедневная работа → **P2** ученики/админ → **P3** серии, история, техдолг.

---

## P0 — согласованность с «блокнотом»

- [x] **Текст отмены занятия** — в `ScheduleCancelModal` убрать «ученик получит уведомление» или показывать только если у занятия есть `telegram_id` (`ScheduleLessonActionModals.tsx`).
- [x] **Оплата в UI** (формулировки «ждёт отметку» / «отмечена») — скрыть блок «Оплата» и чипы paid/unpaid на плитках, если `isPaid == null` или политика «блокнот без биллинга» (`ScheduleRightPanel`, `eventPaymentLabel` / `ScheduleWeekBoard`, `ScheduleDayTimeline`).
- [ ] **Индивидуальное без ученика** — либо required `ScheduleRosterSelect` при `kind === individual`, либо явный переключатель «Без ученика (только слот)» + понятный `participantLabel` в календаре (`ScheduleAddModal.tsx`).
- [ ] **Документировать для админа (до UI)** — в `docs/` или комментарий: roster только через препода или SQL `schedule_students.teacher_telegram_id` (см. `schedule-teacher-backlog` admin item P2).

---

## P1 — ежедневная работа

- [ ] **Редактирование занятия в панели** — тема, комментарий/plan, meet/board URL; PATCH `/api/cabinet/teacher/lessons/[id]` уже есть (`ScheduleRightPanel.tsx` + форма или inline).
- [x] **Перерывы и блокировки** — `ScheduleDaySlotModal`, клик по блоку — подключить `ScheduleSlotFormModal` / удаление через `ScheduleSlotSidePanel` или клик по `sr-dt-block` на таймлайне; API `/api/cabinet/teacher/day-slots` (`TeacherSchedulePanel.tsx`, `ScheduleDayTimeline.tsx`).
- [x] **«Завершить занятие»** — убрано из UI, completed скрыты в календаре — вернуть одну кнопку в карточку занятия *или* убрать `ScheduleCompleteModal` и не показывать `completed` в календаре, если завершение не используется (`TeacherSchedulePanel`, `ScheduleRightPanel`).
- [x] **focusLessonId** — логика в `useEffect` (`TeacherSchedulePanel.tsx`).

---

## P2 — ученики и админ

- [x] **Архив: восстановление** — блок «Архив» в правой панели.
- [x] **Архив + будущие занятия** — чекбокс при архивации + `cancelFutureLessons` в API.
- [x] **Удаление ученика** — кнопка «Удалить» в карточке, опционально с будущими занятиями.
- [ ] **Админ: roster для препода** — UI выбор `teacher_telegram_id` из staff + CRUD `schedule_students` (новый `/api/cabinet/admin/...` или staff-only с проверкой admin; не использовать client `teacherId` без серверной роли).
- [ ] **Длинный roster** — поиск/скролл в `ScheduleRosterSelect`; опционально вернуть `TeacherStudentsPanel` в навигацию staff или full-screen список.

---

## P3 — серии, история, техдолг

- [x] **Серии в UI (частично)** — метка «· Серия» на плитках, счётчик в карточке занятия; массовые операции — позже.
- [ ] **Отменённые / прошедшие** — фильтр или вклад «История» (read-only), без возврата `showCancelled` для всех; опционально только admin preview.
- [ ] **Удалить или подключить мёртвый код** — `ScheduleSidePanel.tsx`, `ScheduleAutoFillModal.tsx`, если не планируются.
- [x] **Backend legacy** — schedule POST без TG/groupId CRM — отключить или 403 ветки `studentTelegramId` / education `groupId` в `schedule/route.ts`, если продукт только блокнот (отдельная задача, тесты).
- [ ] **Мобила: неделя** — опциональный compact week или hint «на планшете — недельный вид» (`ScheduleTopbar`, `TeacherSchedulePanel` effectiveView).
- [ ] **Дубль «Добавить занятие»** — оставить одну точку входа на mobile agenda vs topbar (`ScheduleDayAgenda.tsx`).

---

## Критерии приёмки (общие)

- Изоляция: все новые API — `getStaffAuth().telegramId` / admin override с явной ролью.
- Без регрессии: серии, apply-day/week с moves, optimistic patch, скрытие cancelled в календаре.
- После P0: нет вводящих в заблуждение TG/оплата на чистых roster-занятиях.

## Связанные файлы

| Область | Файлы |
|---------|--------|
| Shell | `TeacherSchedulePanel.tsx`, `ScheduleTopbar.tsx`, `ScheduleRightPanel.tsx` |
| Модалки | `ScheduleAddModal.tsx`, `ScheduleLessonActionModals.tsx`, `ScheduleRosterModals.tsx`, `ScheduleWorkingHoursModal.tsx`, `ScheduleDayHoursModal.tsx` |
| Сетка | `ScheduleWeekBoard.tsx`, `ScheduleDayTimeline.tsx`, `ScheduleMonthGrid.tsx`, `ScheduleDayAgenda.tsx` |
| API | `api/cabinet/teacher/schedule/*`, `roster/*`, `lessons/*`, `day-slots/*`, `availability/*` |
| Изоляция | `lib/teacher/lesson-ownership.ts` |
