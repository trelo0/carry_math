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
import type { StaffScreenNav } from './staff-screen-nav';
import type { CuratorAttentionItem } from './curator-attention';
import { loadCuratorCourseStudents, type CuratorStudentView } from '@/lib/curator/students';

function backButton(text: string, callback: string) {
  return { text, callback_data: callback };
}

function navBack(nav?: StaffScreenNav): string {
  return nav?.mainMenuBack ?? 'c:menu';
}

export function renderCuratorActivityHome(
  snapshot: CuratorActivitySnapshot,
  cabinetUrl: string | null,
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  const parts = [
    '🎓 Курс и прогресс',
    '',
    snapshot.liveLine,
    snapshot.nextLine,
    '',
    `Учеников на курсе: ${snapshot.courseStudentCount}`,
    `ДЗ на проверке: ${snapshot.awaitingReview}`,
    `Требует внимания: ${snapshot.attentionCount}`,
  ];
  if (snapshot.newQuestions > 0) {
    parts.push(`Непрочитанных диалогов: ${snapshot.newQuestions} (раздел «Сообщения»)`);
  }

  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: withCuratorCabinetRow(
        [
          [{ text: '👨‍🎓 Ученики курса', callback_data: 'c:act:students' }],
          [
            {
              text: `🔴 ДЗ на проверке (${snapshot.awaitingReview})`,
              callback_data: 'c:act:review',
            },
          ],
          [
            {
              text: `⚠️ Требует внимания (${snapshot.attentionCount})`,
              callback_data: 'c:act:attn',
            },
          ],
          [backButton('⬅️ Главное меню', navBack(nav))],
        ],
        cabinetUrl,
        { includeCabinet: false },
      ),
    },
  };
}

export function renderCuratorCourseStudentsBotList(
  students: CuratorStudentView[],
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  if (students.length === 0) {
    return {
      text:
        '👨‍🎓 Ученики курса\n\n' +
        'Пока никого с активным доступом к курсу. Проверьте зачисление и user_accesses / course_enrollments.',
      keyboard: {
        inline_keyboard: [[backButton('⬅️ Назад', 'c:act')]],
      },
    };
  }
  const lines = ['👨‍🎓 Ученики курса', ''];
  for (const s of students) {
    lines.push(
      `• ${s.name}`,
      `  Прогресс: ${s.completedLessons}/${s.totalLessons} (${s.progressPercent}%)`,
      `  ❤️ ${s.livesCurrent ?? '—'}${s.livesMax != null ? `/${s.livesMax}` : ''}${s.accessBlocked ? ' · 🔒 доступ ограничен' : ''}`,
      '',
    );
  }
  return {
    text: lines.join('\n').trim().slice(0, 3900),
    keyboard: {
      inline_keyboard: [
        ...students.map((s) => [
          { text: s.name.slice(0, 50), callback_data: `c:sp:${s.id}` },
        ]),
        [backButton('⬅️ Назад', 'c:act')],
      ],
    },
  };
}

export function renderCuratorAttentionList(
  items: CuratorAttentionItem[],
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  const parts = ['⚠️ Требует внимания', ''];
  if (items.length === 0) {
    parts.push('Сейчас нет ситуаций по порогам (жизни, активность, доступ, оплата).');
  } else {
    parts.push(...items.map((i) => `• ${i.label}`));
  }
  return {
    text: parts.join('\n').slice(0, 3900),
    keyboard: {
      inline_keyboard: [
        ...items.map((i) => [{ text: i.label.slice(0, 60), callback_data: `c:sp:${i.studentId}` }]),
        [backButton('⬅️ Назад', 'c:act')],
      ],
    },
  };
}

export function renderCuratorActivityReviewList(
  items: CuratorHomeworkListItem[],
  cabinetUrl: string | null,
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  return renderCuratorHomeworkList('pending', items, cabinetUrl, {
    categoriesBack: 'c:act',
    mainMenuBack: nav?.mainMenuBack,
  });
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
