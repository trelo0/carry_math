import type { InlineKeyboard } from '@/lib/bot/admin/core';
import type { CuratorHomeworkRecord, CuratorStudentRecord } from '@/lib/bot/curator/curatorData';
import { CURATOR_HW_STATUS_SHORT } from '@/lib/bot/curator/curator-types';
import { withCuratorCabinetRow } from './curator-cabinet-ui';
import { CURATOR_DEFAULT_NAV, type StaffScreenNav } from './staff-screen-nav';

export type CuratorHomeworkQueueKind = 'pending' | 'revision' | 'done' | 'all';

function backButton(text: string, callback: string) {
  return { text, callback_data: callback };
}

export type CuratorHomeworkListItem = {
  studentId: string;
  studentName: string;
  homework: CuratorHomeworkRecord;
};

function queueStatus(kind: CuratorHomeworkQueueKind): CuratorHomeworkRecord['status'] {
  if (kind === 'pending') return 'submitted';
  if (kind === 'revision') return 'revision';
  return 'approved';
}

export function collectCuratorHomeworkQueue(
  students: CuratorStudentRecord[],
  kind: CuratorHomeworkQueueKind,
): CuratorHomeworkListItem[] {
  const out: CuratorHomeworkListItem[] = [];
  for (const student of students) {
    for (const homework of student.homeworks) {
      if (kind === 'all') {
        if (homework.status === 'upcoming') continue;
        out.push({ studentId: student.id, studentName: student.name, homework });
      } else if (homework.status === queueStatus(kind)) {
        out.push({ studentId: student.id, studentName: student.name, homework });
      }
    }
  }
  out.sort(
    (a, b) =>
      a.homework.number - b.homework.number ||
      a.studentName.localeCompare(b.studentName, 'ru'),
  );
  return out;
}

function listLabel(item: CuratorHomeworkListItem): string {
  const short = CURATOR_HW_STATUS_SHORT[item.homework.status];
  return `${item.studentName} · ДЗ №${item.homework.number} — ${short}`.slice(0, 60);
}

const QUEUE_TITLES: Record<CuratorHomeworkQueueKind, string> = {
  pending: '🔴 НА ПРОВЕРКЕ',
  revision: '🔄 НА ДОРАБОТКЕ',
  done: '🟢 ПРОВЕРЕННЫЕ',
  all: '📋 ВСЕ',
};

function navOrDefault(nav?: StaffScreenNav): StaffScreenNav {
  return { ...CURATOR_DEFAULT_NAV, ...nav };
}

export function renderCuratorHomeworkHub(
  cabinetUrl: string | null,
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  const n = navOrDefault(nav);
  return {
    text:
      '📝 Домашние задания курса\n\n' +
      'Сданные работы учеников онлайн-курса. Выберите очередь:',
    keyboard: {
      inline_keyboard: withCuratorCabinetRow(
        [
          [{ text: '🔴 На проверке', callback_data: 'c:hw:q:pending' }],
          [{ text: '🔄 На доработке', callback_data: 'c:hw:q:revision' }],
          [{ text: '🟢 Проверенные', callback_data: 'c:hw:q:done' }],
          [{ text: '📋 Все', callback_data: 'c:hw:q:all' }],
          [backButton('⬅️ Главное меню', n.mainMenuBack ?? 'c:menu')],
        ],
        cabinetUrl,
        { includeCabinet: false },
      ),
    },
  };
}

export function renderCuratorHomeworkList(
  kind: CuratorHomeworkQueueKind,
  items: CuratorHomeworkListItem[],
  cabinetUrl: string | null,
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  const n = navOrDefault(nav);
  const parts = [`📝 ${QUEUE_TITLES[kind]}`, ''];
  if (items.length === 0) {
    parts.push('В этой категории пока ничего нет.');
  } else {
    parts.push(...items.map((i) => `• ${listLabel(i)}`));
  }
  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: withCuratorCabinetRow(
        [
          ...items.map((i) => [
            {
              text: listLabel(i),
              callback_data: `c:shw:${i.studentId}:${i.homework.number}`,
            },
          ]),
          [backButton('⬅️ К категориям', n.categoriesBack ?? 'c:hw')],
        ],
        cabinetUrl,
        { includeCabinet: false },
      ),
    },
  };
}
