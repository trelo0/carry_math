import type { InlineKeyboard } from '@/lib/bot/admin/core';
import { listCuratorStudentLabel, type CuratorStudentRecord } from '@/lib/bot/curator/curatorData';
import type { CuratorActivitySnapshot, CuratorLowLivesEntry } from './curator-activity-data';
import { CURATOR_LOW_ACTIVITY_DAYS } from './curator-activity-data';
import {
  collectCuratorHomeworkQueue,
  renderCuratorHomeworkList,
  type CuratorHomeworkListItem,
} from './curator-homework-screens';
import { withCuratorCabinetRow } from './curator-cabinet-ui';

function backButton(text: string, callback: string) {
  return { text, callback_data: callback };
}

export function renderCuratorActivityHome(
  snapshot: CuratorActivitySnapshot,
  cabinetUrl: string | null,
): { text: string; keyboard: InlineKeyboard } {
  const parts = [
    '🎓 КУРС И ПРОГРЕСС',
    '',
    snapshot.liveLine,
    snapshot.nextLine,
    '',
    'Где нужно внимание:',
    `• Ожидают проверки: ${snapshot.awaitingReview}`,
    `• Новые вопросы: ${snapshot.newQuestions}`,
    `• Мало жизней Arena: ${snapshot.lowLivesCount}`,
    `• Низкая активность (>${CURATOR_LOW_ACTIVITY_DAYS} дн.): ${snapshot.lowActivityCount}`,
  ];

  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: withCuratorCabinetRow(
        [
          [{ text: `🔴 Ожидают проверки (${snapshot.awaitingReview})`, callback_data: 'c:act:review' }],
          [{ text: `💬 Новые вопросы (${snapshot.newQuestions})`, callback_data: 'c:act:msg' }],
          [{ text: `❤️ Мало жизней (${snapshot.lowLivesCount})`, callback_data: 'c:act:lives' }],
          [{ text: `📉 Низкая активность (${snapshot.lowActivityCount})`, callback_data: 'c:act:low' }],
          [backButton('⬅️ Главное меню', 'c:menu')],
        ],
        cabinetUrl,
      ),
    },
  };
}

export function renderCuratorActivityReviewList(
  items: CuratorHomeworkListItem[],
  cabinetUrl: string | null,
): { text: string; keyboard: InlineKeyboard } {
  return renderCuratorHomeworkList('pending', items, cabinetUrl);
}

export function renderCuratorLowLivesList(
  entries: CuratorLowLivesEntry[],
  cabinetUrl: string | null,
): { text: string; keyboard: InlineKeyboard } {
  const parts = ['❤️ МАЛО ЖИЗНЕЙ ARENA', ''];
  if (entries.length === 0) {
    parts.push('Сейчас никто не ниже порога.');
  } else {
    parts.push('Выберите ученика:');
  }

  const buttons = entries.map((e) => [
    {
      text: `${e.student.name} — ${e.livesCurrent}${e.livesMax != null ? `/${e.livesMax}` : ''}`.slice(0, 60),
      callback_data: `c:sp:${e.student.id}`,
    },
  ]);

  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: withCuratorCabinetRow(
        [...buttons, [backButton('⬅️ К активности', 'c:act')]],
        cabinetUrl,
      ),
    },
  };
}

export function renderCuratorLowActivityList(
  students: CuratorStudentRecord[],
  cabinetUrl: string | null,
): { text: string; keyboard: InlineKeyboard } {
  const parts = [
    '📉 НИЗКАЯ АКТИВНОСТЬ',
    '',
    `Критерий v1: зачислены более ${CURATOR_LOW_ACTIVITY_DAYS} дней назад, нет сдач и завершённых уроков за этот период.`,
    '',
  ];
  if (students.length === 0) {
    parts.push('По этому критерию учеников нет.');
  } else {
    parts.push('Выберите ученика:');
  }

  const buttons = students.map((s) => [
    { text: listCuratorStudentLabel(s).slice(0, 60), callback_data: `c:sp:${s.id}` },
  ]);

  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: withCuratorCabinetRow(
        [...buttons, [backButton('⬅️ К активности', 'c:act')]],
        cabinetUrl,
      ),
    },
  };
}

export function pendingHomeworkFromStudents(students: CuratorStudentRecord[]) {
  return collectCuratorHomeworkQueue(students, 'pending');
}
