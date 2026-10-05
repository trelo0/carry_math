import type { InlineButton } from './core';

/** Навигация из карточки человека (фаза 0 — часть ссылок на существующие ae:/admin:). */
export function personHubNavRows(telegramId: number, isStudent: boolean): InlineButton[][] {
  const id = telegramId;
  const rows: InlineButton[][] = [
    [
      { text: '📚 Обучение', callback_data: isStudent ? `ae:access:${id}` : `admin:user:${id}::` },
      { text: '📅 Занятия', callback_data: `ae:sched:${id}` },
    ],
  ];
  if (isStudent) {
    rows.push([
      { text: '💳 Доступы', callback_data: `ae:access:${id}` },
      { text: '📦 Пакет', callback_data: `ae:access:${id}` },
    ]);
    rows.push([
      { text: '📝 ДЗ', callback_data: `ah:person:${id}:hw` },
      { text: '💬 Сообщения', callback_data: `ah:person:${id}:msg` },
    ]);
  }
  rows.push([{ text: '📜 История', callback_data: `ah:person:${id}:history` }]);
  return rows;
}
