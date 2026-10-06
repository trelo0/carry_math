import type { InlineKeyboard } from '@/lib/bot/admin/core';
import type { StaffMessageRow, StaffThreadSummary } from './messaging';
import type { TeacherHomeworkListItem, TeacherHomeworkQueueKind } from './teacher-homework';
import { homeworkListLabel } from './teacher-homework';
import { withTeacherCabinetRow } from './teacher-cabinet-ui';
import { TEACHER_DEFAULT_NAV, type StaffScreenNav } from './staff-screen-nav';

function backButton(text: string, callback: string) {
  return { text, callback_data: callback };
}

function navOrDefault(nav?: StaffScreenNav): StaffScreenNav {
  return { ...TEACHER_DEFAULT_NAV, ...nav };
}

export function renderTeacherMessagesInbox(
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
      callback_data: `t:msg:d:${t.studentTelegramId}`,
    },
  ]);

  const unreadCount = threads.filter((t) => t.unreadCount > 0).length;

  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: withTeacherCabinetRow(
        [
          ...buttons,
          ...(unreadCount > 0
            ? [[{ text: `🔴 Непрочитанные (${unreadCount})`, callback_data: 't:msg:u' }]]
            : []),
          [backButton('⬅️ Главное меню', n.mainMenuBack ?? 't:menu')],
        ],
        cabinetUrl,
      ),
    },
  };
}

export function renderTeacherUnreadMessagesInbox(
  threads: StaffThreadSummary[],
  storageEnabled: boolean,
  cabinetUrl: string | null,
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  const n = navOrDefault(nav);
  const unread = threads.filter((t) => t.unreadCount > 0);
  const parts = ['💬 НЕПРОЧИТАННЫЕ', ''];
  if (!storageEnabled) {
    parts.push('Список доступен после миграции staff_student_messages.sql.', '');
  }
  if (unread.length === 0) {
    parts.push('Непрочитанных сообщений нет.');
  } else {
    parts.push('Выберите диалог:');
  }

  const buttons = unread.map((t) => [
    {
      text: `🔴 ${t.studentLabel}`.slice(0, 60),
      callback_data: `t:msg:d:${t.studentTelegramId}`,
    },
  ]);

  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: withTeacherCabinetRow(
        [
          ...buttons,
          [backButton('⬅️ Все сообщения', n.listBack ?? 't:msg:l')],
          [backButton('⬅️ Главное меню', n.mainMenuBack ?? 't:menu')],
        ],
        cabinetUrl,
      ),
    },
  };
}

export function renderTeacherMessageThread(
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
      const who = msg.direction === 'student_to_staff' ? '👤 Ученик' : '👨‍🏫 Вы';
      const time = new Date(msg.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' });
      parts.push(`${who} · ${time}`, msg.body, '');
    }
  }

  return {
    text: parts.join('\n').slice(0, 3900),
    keyboard: {
      inline_keyboard: withTeacherCabinetRow(
        [
          [{ text: '✏️ Написать', callback_data: `t:msg:w:${studentTelegramId}` }],
          [backButton('⬅️ К списку', n.listBack ?? 't:msg:l')],
        ],
        cabinetUrl,
      ),
    },
  };
}

const QUEUE_TITLES: Record<TeacherHomeworkQueueKind, string> = {
  pending: '🔴 НА ПРОВЕРКЕ',
  revision: '🔄 НА ДОРАБОТКЕ',
  done: '🟢 ПРОВЕРЕННЫЕ',
  all: '📋 ВСЕ',
};

export function renderTeacherHomeworkList(
  queue: TeacherHomeworkQueueKind,
  items: TeacherHomeworkListItem[],
  cabinetUrl: string | null,
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  const n = navOrDefault(nav);
  const parts = [`📝 ${QUEUE_TITLES[queue]}`, ''];
  if (items.length === 0) {
    parts.push('В этой категории пока ничего нет.');
  } else {
    parts.push(...items.map((i) => `• ${homeworkListLabel(i)}`));
  }
  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: withTeacherCabinetRow(
        [
          ...items.map((i) => [{ text: homeworkListLabel(i), callback_data: `t:hw:i:${i.lessonId}` }]),
          [backButton('⬅️ К категориям', n.categoriesBack ?? 't:hw')],
        ],
        cabinetUrl,
        { includeCabinet: false },
      ),
    },
  };
}

export function renderTeacherHomeworkCardActions(
  lessonId: number,
  canReview: boolean,
  cabinetUrl: string | null,
  listBack = 't:hw:q:pending',
): InlineKeyboard {
  const rows: InlineKeyboard['inline_keyboard'] = [
    [{ text: '👀 Посмотреть работу', callback_data: `t:hw:v:${lessonId}` }],
  ];
  if (canReview) {
    rows.push(
      [{ text: '✅ Принять', callback_data: `t:hw:ok:${lessonId}` }],
      [{ text: '❌ На доработку', callback_data: `t:hw:rev:${lessonId}` }],
    );
  }
  rows.push([backButton('⬅️ К списку', listBack)]);
  return { inline_keyboard: withTeacherCabinetRow(rows, cabinetUrl, { includeCabinet: false }) };
}

export function renderTeacherHomeworkHub(
  cabinetUrl: string | null,
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  const n = navOrDefault(nav);
  return {
    text: '📝 ДОМАШНИЕ ЗАДАНИЯ\n\nВыберите категорию:',
    keyboard: {
      inline_keyboard: withTeacherCabinetRow(
        [
          [{ text: '🔴 На проверке', callback_data: 't:hw:q:pending' }],
          [{ text: '🔄 На доработке', callback_data: 't:hw:q:revision' }],
          [{ text: '🟢 Проверенные', callback_data: 't:hw:q:done' }],
          [{ text: '📋 Все', callback_data: 't:hw:q:all' }],
          [backButton('⬅️ Главное меню', n.mainMenuBack ?? 't:menu')],
        ],
        cabinetUrl,
        { includeCabinet: false },
      ),
    },
  };
}
