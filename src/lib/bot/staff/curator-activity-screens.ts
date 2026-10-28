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
import { staffDmTopicsEnabled } from './dm-topics';

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
    snapshot.lastLine,
    snapshot.nextLine,
    snapshot.liveLine,
    '',
    `Учеников на курсе: ${snapshot.courseStudentCount}`,
    `ДЗ на проверке: ${snapshot.awaitingReview}`,
    `Просрочки ДЗ: ${snapshot.overdueCount}`,
    `Заморозка (0 жизней): ${snapshot.frozenCount}`,
    `⚠️ Требует внимания: ${snapshot.attentionCount}`,
  ];
  if (!staffDmTopicsEnabled() && snapshot.newQuestions > 0) {
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
              text: `⚠️ Проблемы (${snapshot.attentionCount})`,
              callback_data: 'c:act:attn',
            },
          ],
          [
            {
              text: `🔴 ДЗ на проверке (${snapshot.awaitingReview})`,
              callback_data: 'c:act:review',
            },
          ],
          [
            {
              text: `❤️ Мало жизней (${snapshot.lowLives.length})`,
              callback_data: 'c:act:lives',
            },
          ],
          [{ text: '📅 Назначить дату занятия', callback_data: 'c:sch:list' }],
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
  const back = nav?.listBack ?? 'c:act';
  if (students.length === 0) {
    return {
      text:
        '👨‍🎓 Ученики курса\n\n' +
        'Пока никого с активным доступом к курсу. Проверьте зачисление и user_accesses / course_enrollments.',
      keyboard: {
        inline_keyboard: [[backButton('⬅️ Назад', back)]],
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
        [backButton('⬅️ Назад', back)],
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
    parts.push(
      'Сейчас нет ситуаций по порогам:',
      'жизни, заморозка, просрочки, активность, доступ, оплата, stale review.',
    );
  } else {
    parts.push(...items.map((i) => `• ${i.label}`));
  }
  return {
    text: parts.join('\n').slice(0, 3900),
    keyboard: {
      inline_keyboard: [
        ...items.slice(0, 30).map((i) => [
          { text: i.label.slice(0, 60), callback_data: `c:sp:${i.studentId}` },
        ]),
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
  const parts = ['❤️ Мало жизней', '', 'Можно открыть карточку или сразу +1 / −1.', ''];
  if (entries.length === 0) {
    parts.push('Сейчас никто не ниже порога.');
  }

  const rows: InlineKeyboard['inline_keyboard'] = [];
  for (const e of entries.slice(0, 20)) {
    const lives = `${e.livesCurrent}${e.livesMax != null ? `/${e.livesMax}` : ''}`;
    rows.push([
      {
        text: `${e.student.name} — ${lives}`.slice(0, 40),
        callback_data: `c:sp:${e.student.id}`,
      },
      { text: '+1', callback_data: `c:life:g:${e.student.telegramId}` },
      { text: '−1', callback_data: `c:life:d:${e.student.telegramId}` },
    ]);
  }
  rows.push([backButton('⬅️ К курсу', 'c:act')]);

  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: withCuratorCabinetRow(rows, cabinetUrl, { includeCabinet: false }),
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
