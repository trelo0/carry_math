import type { InlineKeyboard } from '@/lib/bot/admin/core';
import { withTeacherCabinetRow } from './teacher-cabinet-ui';

function backButton(text: string, callback: string) {
  return { text, callback_data: callback };
}

export function renderCombinedStudentsHub(cabinetUrl: string | null): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: [
      '👥 МОИ УЧЕНИКИ',
      '',
      'Один раздел — два контекста:',
      '🎓 курс — выберите курс и роль в «🎓 Курс» · 🏫 занятия (преподаватель)',
      '',
      'Выберите:',
    ].join('\n'),
    keyboard: {
      inline_keyboard: withTeacherCabinetRow(
        [
          [{ text: '🎓 Ученики курса', callback_data: 's:stu:c' }],
          [{ text: '🏫 Ученики занятий', callback_data: 's:stu:les' }],
          [backButton('⬅️ Главное меню', 's:menu')],
        ],
        cabinetUrl,
        { includeCabinet: false },
      ),
    },
  };
}

export function renderCombinedLessonStudentsHub(cabinetUrl: string | null): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: [
      '🏫 Ученики занятий',
      '',
      'Индивидуальные и мини-группы, где вы преподаватель.',
    ].join('\n'),
    keyboard: {
      inline_keyboard: withTeacherCabinetRow(
        [
          [{ text: '👤 Индивидуальные', callback_data: 's:stu:i' }],
          [{ text: '👥 Мини-группы', callback_data: 's:stu:g' }],
          [backButton('⬅️ К ученикам', 's:stu')],
        ],
        cabinetUrl,
        { includeCabinet: false },
      ),
    },
  };
}

export function renderCombinedHomeworkHub(cabinetUrl: string | null): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: [
      '📝 ДОМАШНИЕ ЗАДАНИЯ',
      '',
      '🎓 Курс — ДЗ по назначению на курс (куратор / проверка)',
      '🏫 Занятия — ДЗ после уроков с преподавателем',
    ].join('\n'),
    keyboard: {
      inline_keyboard: withTeacherCabinetRow(
        [
          [{ text: '🎓 Домашки курса', callback_data: 's:hw:c' }],
          [{ text: '🏫 Домашки занятий', callback_data: 's:hw:t' }],
          [backButton('⬅️ Главное меню', 's:menu')],
        ],
        cabinetUrl,
        { includeCabinet: false },
      ),
    },
  };
}

export function renderCombinedMessagesHub(cabinetUrl: string | null): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: [
      '💬 СООБЩЕНИЯ',
      '',
      '🎓 Курс — переписка с учениками курса',
      '🏫 Занятия — переписка с учениками занятий',
    ].join('\n'),
    keyboard: {
      inline_keyboard: withTeacherCabinetRow(
        [
          [{ text: '🎓 Сообщения курса', callback_data: 's:msg:c' }],
          [{ text: '🏫 Сообщения занятий', callback_data: 's:msg:t' }],
          [backButton('⬅️ Главное меню', 's:menu')],
        ],
        cabinetUrl,
        { includeCabinet: false },
      ),
    },
  };
}

export function renderCombinedScheduleHub(cabinetUrl: string | null): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: [
      '📅 РАСПИСАНИЕ',
      '',
      '🎓 Курс — эфиры/уроки курса (дата, прошлое/следующее)',
      '🏫 Занятия — ваше расписание преподавателя',
    ].join('\n'),
    keyboard: {
      inline_keyboard: withTeacherCabinetRow(
        [
          [{ text: '🎓 Расписание курса', callback_data: 's:sch:c' }],
          [{ text: '🏫 Расписание занятий', callback_data: 's:sch:t' }],
          [backButton('⬅️ Главное меню', 's:menu')],
        ],
        cabinetUrl,
        { includeCabinet: false },
      ),
    },
  };
}

export function renderCombinedCourseSchedule(
  lastLine: string,
  nextLine: string,
  nextSanityId: string | null,
  cabinetUrl: string | null,
): { text: string; keyboard: InlineKeyboard } {
  const rows: InlineKeyboard['inline_keyboard'] = [];
  if (nextSanityId) {
    rows.push([{ text: '📅 Назначить дату следующего', callback_data: `c:sch:pick:${nextSanityId}` }]);
  }
  rows.push([{ text: '📅 Выбрать занятие для даты', callback_data: 'c:sch:list' }]);
  rows.push([backButton('⬅️ На главную', 's:menu')]);

  return {
    text: ['🎓 Расписание курса', '', lastLine, nextLine, '', 'Назначьте дату эфира/урока:'].join('\n'),
    keyboard: {
      inline_keyboard: withTeacherCabinetRow(rows, cabinetUrl, { includeCabinet: false }),
    },
  };
}
