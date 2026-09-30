import type { InlineKeyboard } from '@/lib/bot/admin/core';
import type { StaffMessageRow, StaffThreadSummary } from './messaging';
import { withCuratorCabinetRow } from './curator-cabinet-ui';
import { CURATOR_DEFAULT_NAV, type StaffScreenNav } from './staff-screen-nav';

function backButton(text: string, callback: string) {
  return { text, callback_data: callback };
}

function navOrDefault(nav?: StaffScreenNav): StaffScreenNav {
  return { ...CURATOR_DEFAULT_NAV, ...nav };
}

export function renderCuratorMessagesInbox(
  threads: StaffThreadSummary[],
  storageEnabled: boolean,
  cabinetUrl: string | null,
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  const n = navOrDefault(nav);
  const parts = ['💬 СООБЩЕНИЯ', ''];
  if (!storageEnabled) {
    parts.push(
      'История переписки пока недоступна (не применена миграция staff_student_messages.sql).',
      'Новые сообщения учеников всё равно приходят в этот чат.',
      '',
    );
  }
  if (threads.length === 0) {
    parts.push('Диалогов пока нет. Напишите ученику из карточки или дождитесь обращения.');
  } else {
    parts.push('Выберите диалог:');
  }

  const buttons = threads.map((t) => [
    {
      text: `${t.unreadCount > 0 ? '🔴 ' : ''}${t.studentLabel}`.slice(0, 60),
      callback_data: `c:msg:d:${t.studentTelegramId}`,
    },
  ]);

  const unreadCount = threads.filter((t) => t.unreadCount > 0).length;

  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: withCuratorCabinetRow(
        [
          ...buttons,
          ...(unreadCount > 0
            ? [[{ text: `🔴 Непрочитанные (${unreadCount})`, callback_data: 'c:msg:u' }]]
            : []),
          [backButton('⬅️ Главное меню', n.mainMenuBack ?? 'c:menu')],
        ],
        cabinetUrl,
      ),
    },
  };
}

export function renderCuratorMessageThread(
  studentLabel: string,
  messages: StaffMessageRow[],
  storageEnabled: boolean,
  cabinetUrl: string | null,
  studentTelegramId: number,
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  const n = navOrDefault(nav);
  const parts = [`💬 ${studentLabel}`, ''];
  if (!storageEnabled) {
    parts.push('История не сохранена. Ответ уйдёт ученику через бота.', '');
  } else if (messages.length === 0) {
    parts.push('Сообщений в истории пока нет.', '');
  } else {
    for (const msg of messages) {
      const who = msg.direction === 'student_to_staff' ? '👤 Ученик' : '🧑‍🏫 Вы';
      const time = new Date(msg.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' });
      parts.push(`${who} · ${time}`, msg.body, '');
    }
  }

  return {
    text: parts.join('\n').slice(0, 3900),
    keyboard: {
      inline_keyboard: withCuratorCabinetRow(
        [
          [{ text: '✏️ Написать', callback_data: `c:msg:w:${studentTelegramId}` }],
          [backButton('⬅️ К списку', n.listBack ?? 'c:msg:l')],
        ],
        cabinetUrl,
      ),
    },
  };
}

export function renderCuratorUnreadThreadsInbox(
  threads: StaffThreadSummary[],
  storageEnabled: boolean,
  cabinetUrl: string | null,
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  const n = navOrDefault(nav);
  const unread = threads.filter((t) => t.unreadCount > 0);
  const parts = ['💬 НОВЫЕ ВОПРОСЫ', ''];
  if (!storageEnabled) {
    parts.push('Список непрочитанных доступен после миграции staff_student_messages.sql.', '');
  }
  if (unread.length === 0) {
    parts.push('Непрочитанных обращений нет.');
  } else {
    parts.push('Выберите диалог:');
  }

  const buttons = unread.map((t) => [
    {
      text: `🔴 ${t.studentLabel}`.slice(0, 60),
      callback_data: `c:msg:d:${t.studentTelegramId}`,
    },
  ]);

  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: withCuratorCabinetRow(
        [
          ...buttons,
          [backButton('⬅️ Все сообщения', n.listBack ?? 'c:msg:l')],
          [backButton('⬅️ К активности', 'c:act')],
        ],
        cabinetUrl,
      ),
    },
  };
}
