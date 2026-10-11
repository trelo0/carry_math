/**
 * Админ: Обучение → Жизни — сводка, списки 0/1/2, просрочки, настройки.
 * Callbacks: ae:lives | ae:lives:n:{0|1|2}:{page} | ae:lives:od:{page} | ae:lives:set
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCourseIdForContent } from '@/lib/bot/education/course-record';
import {
  countOverdueHomeworkForHub,
  getLivesHubCounts,
  isLivesTableError,
  listEnrollmentsWithLivesCurrent,
  listOverdueHomeworkForHub,
  moscowPeriodKey,
} from '@/lib/bot/education/lives';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';
import { getMember } from '@/lib/bot/roles';
import {
  type AdminMessage,
  type InlineButton,
  editAdminMessage,
  homeButton,
  shorten,
} from './core';
import { memberDisplayName } from './users';

const PAGE = 8;

async function resolveHubCourseId(admin: SupabaseClient): Promise<number | null> {
  const content = await getDistrictCourseContent().catch(() => null);
  if (!content) return null;
  return resolveCourseIdForContent(admin, content);
}

function formatDeadlineShort(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16);
  }
}

export function isLivesHubAction(data: string): boolean {
  return data === 'ae:lives' || data.startsWith('ae:lives:');
}

export async function renderLivesHub(
  admin: SupabaseClient,
  message: AdminMessage,
): Promise<void> {
  try {
    const courseId = await resolveHubCourseId(admin);
    const [counts, overdueCount] = await Promise.all([
      getLivesHubCounts(admin, courseId),
      countOverdueHomeworkForHub(admin),
    ]);

    const lines = [
      '❤️ Жизни на курсе',
      '',
      `Учеников с жизнями: ${counts.total}`,
      `❤️ 0: ${counts.zero} · 1: ${counts.one} · 2: ${counts.two} · полные: ${counts.full}`,
      `⏸️ Заморозка: ${counts.frozen}`,
      `🔒 Полная блокировка: ${counts.fullyBlocked}`,
      `📉 Ниже максимума: ${counts.belowMax}`,
      `⏱ Просрочки ДЗ: ${overdueCount}`,
      '',
      'Откройте список или настройки ниже.',
    ];

    const keyboard: InlineButton[][] = [
      [
        { text: `0 жизней (${counts.zero})`, callback_data: 'ae:lives:n:0:0' },
        { text: `1 жизнь (${counts.one})`, callback_data: 'ae:lives:n:1:0' },
      ],
      [
        { text: `2 жизни (${counts.two})`, callback_data: 'ae:lives:n:2:0' },
        { text: `⏱ Просрочки (${overdueCount})`, callback_data: 'ae:lives:od:0' },
      ],
      [{ text: '⚙️ Настройки жизней', callback_data: 'ae:lives:set' }],
      [{ text: '⬅️ Обучение', callback_data: 'ae:menu' }],
      [homeButton()],
    ];

    await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
  } catch (error) {
    if (isLivesTableError(error)) {
      await editAdminMessage(
        message,
        'Таблицы жизней недоступны. Примените миграции course_lives / deadlines.',
        {
          inline_keyboard: [[{ text: '⬅️ Обучение', callback_data: 'ae:menu' }], [homeButton()]],
        },
      );
      return;
    }
    throw error;
  }
}

async function renderLivesBucketList(
  admin: SupabaseClient,
  message: AdminMessage,
  livesCurrent: 0 | 1 | 2,
  page: number,
): Promise<void> {
  const courseId = await resolveHubCourseId(admin);
  const counts = await getLivesHubCounts(admin, courseId);
  const total =
    livesCurrent === 0 ? counts.zero : livesCurrent === 1 ? counts.one : counts.two;
  const pageCount = Math.max(1, Math.ceil(total / PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const rows = await listEnrollmentsWithLivesCurrent(admin, livesCurrent, {
    courseId,
    limit: PAGE,
    offset: safePage * PAGE,
  });

  const title =
    livesCurrent === 0 ? '0 жизней' : livesCurrent === 1 ? '1 жизнь' : '2 жизни';
  const lines = [`❤️ ${title}`, `Всего: ${total}`, ''];

  for (const row of rows) {
    const member = await getMember(admin, row.telegram_id);
    const name = member ? memberDisplayName(member) : `ID ${row.telegram_id}`;
    const flags = [
      row.access_blocked ? '⏸️' : null,
      row.fully_blocked ? '🔒' : null,
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(
      `👤 ${name}`,
      `❤️ ${row.lives_current}/${row.lives_max}${flags ? ` ${flags}` : ''}`,
      '',
    );
  }
  if (rows.length === 0) lines.push('Список пуст.');

  const keyboard: InlineButton[][] = [];
  for (const row of rows) {
    const member = await getMember(admin, row.telegram_id);
    const name = member ? memberDisplayName(member) : `ID ${row.telegram_id}`;
    keyboard.push([
      {
        text: shorten(name, 28),
        callback_data: `al:m:${row.telegram_id}`,
      },
      { text: '+1', callback_data: `al:g:${row.telegram_id}` },
      { text: '−1', callback_data: `al:d:${row.telegram_id}` },
    ]);
  }

  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data:
          safePage > 0 ? `ae:lives:n:${livesCurrent}:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data:
          safePage < pageCount - 1
            ? `ae:lives:n:${livesCurrent}:${safePage + 1}`
            : 'noop',
      },
    ]);
  }
  keyboard.push(
    [{ text: '⬅️ К жизням', callback_data: 'ae:lives' }],
    [homeButton()],
  );

  await editAdminMessage(message, lines.join('\n').slice(0, 3900), {
    inline_keyboard: keyboard,
  });
}

async function renderOverdueList(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  const total = await countOverdueHomeworkForHub(admin);
  const pageCount = Math.max(1, Math.ceil(total / PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const rows = await listOverdueHomeworkForHub(admin, {
    limit: PAGE,
    offset: safePage * PAGE,
  });

  const lines = ['⏱ Просрочки ДЗ', `Всего: ${total}`, ''];
  for (const row of rows) {
    const member = await getMember(admin, row.telegram_id);
    const name = member ? memberDisplayName(member) : `ID ${row.telegram_id}`;
    lines.push(
      `👤 ${name}`,
      `📚 ${shorten(row.sanity_lesson_id, 36)}`,
      `⏰ ${formatDeadlineShort(row.homework_deadline_at)} · ${row.homework_status}`,
      '',
    );
  }
  if (rows.length === 0) lines.push('Просрочек нет.');

  const keyboard: InlineButton[][] = [];
  for (const row of rows) {
    const member = await getMember(admin, row.telegram_id);
    const name = member ? memberDisplayName(member) : `ID ${row.telegram_id}`;
    keyboard.push([
      {
        text: shorten(name, 28),
        callback_data: `al:m:${row.telegram_id}`,
      },
      { text: '+1', callback_data: `al:g:${row.telegram_id}` },
      { text: '−1', callback_data: `al:d:${row.telegram_id}` },
    ]);
  }

  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data: safePage > 0 ? `ae:lives:od:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data:
          safePage < pageCount - 1 ? `ae:lives:od:${safePage + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push(
    [{ text: '⬅️ К жизням', callback_data: 'ae:lives' }],
    [homeButton()],
  );

  await editAdminMessage(message, lines.join('\n').slice(0, 3900), {
    inline_keyboard: keyboard,
  });
}

async function renderLivesSettings(
  admin: SupabaseClient,
  message: AdminMessage,
): Promise<void> {
  const courseId = await resolveHubCourseId(admin);
  const counts = await getLivesHubCounts(admin, courseId);
  const period = moscowPeriodKey();
  const lines = [
    '⚙️ Настройки жизней',
    '',
    `Период МСК: ${period}`,
    `Ниже максимума: ${counts.belowMax}`,
    `Заморозка: ${counts.frozen} · Полная блок.: ${counts.fullyBlocked}`,
    '',
    'Массовое восстановление — до max всем, у кого меньше.',
    'Карточка ученика: +1 / −1 / блокировка / история.',
  ];

  const keyboard: InlineButton[][] = [
    [
      {
        text: `❤️ Восстановить всем (${counts.belowMax})`,
        callback_data: 'al:rm',
      },
    ],
    [
      { text: 'Список: 0', callback_data: 'ae:lives:n:0:0' },
      { text: 'Список: 1', callback_data: 'ae:lives:n:1:0' },
      { text: 'Список: 2', callback_data: 'ae:lives:n:2:0' },
    ],
    [{ text: '⬅️ К жизням', callback_data: 'ae:lives' }],
    [homeButton()],
  ];

  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

export async function handleLivesHubAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
): Promise<boolean> {
  if (!isLivesHubAction(data)) return false;

  if (data === 'ae:lives') {
    await renderLivesHub(admin, message);
    return true;
  }

  if (data === 'ae:lives:set') {
    await renderLivesSettings(admin, message);
    return true;
  }

  const bucket = data.match(/^ae:lives:n:([012]):(\d+)$/);
  if (bucket) {
    await renderLivesBucketList(
      admin,
      message,
      Number(bucket[1]) as 0 | 1 | 2,
      Number(bucket[2]) || 0,
    );
    return true;
  }

  const overdue = data.match(/^ae:lives:od:(\d+)$/);
  if (overdue) {
    await renderOverdueList(admin, message, Number(overdue[1]) || 0);
    return true;
  }

  await renderLivesHub(admin, message);
  return true;
}
