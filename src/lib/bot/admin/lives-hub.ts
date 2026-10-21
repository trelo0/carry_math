/**
 * Админ: Обучение → Жизни — сводка, списки 0/1/2, просрочки, настройки.
 * Callbacks: ae:lives | ae:lives:c:{courseId} | ae:lives:pick[:page]
 * | ae:lives:n:{0|1|2}:{page} | ae:lives:od:{page} | ae:lives:set
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { listCoursesPresentInSanity } from '@/lib/bot/education/course-record';
import { getActiveCourses, getCourse } from '@/lib/bot/education/courses';
import {
  countOverdueHomeworkForHub,
  getLivesHubCounts,
  isLivesTableError,
  listEnrollmentsWithLivesCurrent,
  listOverdueHomeworkForHub,
  moscowPeriodKey,
} from '@/lib/bot/education/lives';
import { findLessonBySanityId } from '@/lib/bot/education/course-homework';
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
import { getAdminLivesHubCourse, setAdminLivesHubCourse } from './lives-hub-course';
import {
  livesDeductCb,
  livesGrantCb,
  livesMenuCb,
  livesMonthlyRestoreCb,
} from './lives-ops-callbacks';

const PAGE = 8;
const COURSES_PER_PAGE = 6;

async function resolveHubCourseId(admin: SupabaseClient, chatId: number): Promise<number | null> {
  const cached = getAdminLivesHubCourse(chatId);
  if (cached != null) return cached;
  return null;
}

async function hubCourseTitle(admin: SupabaseClient, courseId: number | null): Promise<string> {
  if (courseId == null) return 'курс не выбран';
  const course = await getCourse(admin, courseId);
  return course?.title?.trim() || `курс #${courseId}`;
}

async function renderLivesCoursePicker(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  let all = await listCoursesPresentInSanity(admin).catch(() => null);
  if (!all?.length) all = await getActiveCourses(admin);
  const pageCount = Math.max(1, Math.ceil(all.length / COURSES_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const slice = all.slice(safePage * COURSES_PER_PAGE, safePage * COURSES_PER_PAGE + COURSES_PER_PAGE);

  const lines = ['🎓 Курс для раздела «Жизни»', '', 'Выберите курс — сводка и списки будут по нему.'];
  if (slice.length === 0) lines.push('', 'Нет активных курсов.');

  const keyboard: InlineButton[][] = slice.map((c) => [
    { text: shorten(c.title, 40), callback_data: `ae:lives:c:${c.id}` },
  ]);
  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data: safePage > 0 ? `ae:lives:pick:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data: safePage < pageCount - 1 ? `ae:lives:pick:${safePage + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push([{ text: '⬅️ К жизням', callback_data: 'ae:lives' }], [homeButton()]);
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
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
    const courseId = await resolveHubCourseId(admin, message.chatId);
    const courseTitle = await hubCourseTitle(admin, courseId);
    const [counts, overdueCount] = await Promise.all([
      getLivesHubCounts(admin, courseId),
      countOverdueHomeworkForHub(admin, courseId),
    ]);

    const lines = [
      '❤️ Жизни на курсе',
      `🎓 ${courseTitle}`,
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
      [{ text: '🎓 Сменить курс', callback_data: 'ae:lives:pick' }],
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
  const courseId = await resolveHubCourseId(admin, message.chatId);
  const courseTitle = await hubCourseTitle(admin, courseId);
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
  const lines = [`❤️ ${title} · ${courseTitle}`, `Всего: ${total}`, ''];

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
        callback_data: livesMenuCb(row.telegram_id, row.course_id),
      },
      { text: '+1', callback_data: livesGrantCb(row.telegram_id, row.course_id) },
      { text: '−1', callback_data: livesDeductCb(row.telegram_id, row.course_id) },
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

async function overdueLessonLabel(
  admin: SupabaseClient,
  row: Awaited<ReturnType<typeof listOverdueHomeworkForHub>>[number],
): Promise<string> {
  let slug: string | null = null;
  if (row.course_id != null) {
    const { data } = await admin.from('courses').select('slug').eq('id', row.course_id).maybeSingle();
    slug = (data?.slug as string | null) ?? null;
  }
  const content = slug ? await getDistrictCourseContent(slug).catch(() => null) : null;
  const lesson = content ? findLessonBySanityId(content, row.sanity_lesson_id) : null;
  if (lesson) return `№${lesson.lessonNumber} ${lesson.title}`;
  return shorten(row.sanity_lesson_id, 36);
}

async function renderOverdueList(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  const courseId = await resolveHubCourseId(admin, message.chatId);
  const courseTitle = await hubCourseTitle(admin, courseId);
  const total = await countOverdueHomeworkForHub(admin, courseId);
  const pageCount = Math.max(1, Math.ceil(total / PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const rows = await listOverdueHomeworkForHub(admin, {
    courseId,
    limit: PAGE,
    offset: safePage * PAGE,
  });

  const lines = ['⏱ Просрочки ДЗ', `🎓 ${courseTitle}`, `Всего: ${total}`, ''];
  for (const row of rows) {
    const member = await getMember(admin, row.telegram_id);
    const name = member ? memberDisplayName(member) : `ID ${row.telegram_id}`;
    const lessonLabel = await overdueLessonLabel(admin, row);
    lines.push(
      `👤 ${name}`,
      `📚 ${lessonLabel}`,
      `⏰ ${formatDeadlineShort(row.homework_deadline_at)} · ${row.homework_status}`,
      '',
    );
  }
  if (rows.length === 0) lines.push('Просрочек нет.');

  const keyboard: InlineButton[][] = [];
  for (const row of rows) {
    const member = await getMember(admin, row.telegram_id);
    const name = member ? memberDisplayName(member) : `ID ${row.telegram_id}`;
    const cid = row.course_id ?? courseId;
    keyboard.push([
      {
        text: shorten(name, 28),
        callback_data: livesMenuCb(row.telegram_id, cid),
      },
      ...(cid != null
        ? [
            { text: '+1', callback_data: livesGrantCb(row.telegram_id, cid) },
            { text: '−1', callback_data: livesDeductCb(row.telegram_id, cid) },
          ]
        : []),
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
  const courseId = await resolveHubCourseId(admin, message.chatId);
  const courseTitle = await hubCourseTitle(admin, courseId);
  const counts = await getLivesHubCounts(admin, courseId);
  const period = moscowPeriodKey();
  const lines = [
    '⚙️ Настройки жизней',
    `🎓 ${courseTitle}`,
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
        callback_data: livesMonthlyRestoreCb(courseId),
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

  const courseSelect = data.match(/^ae:lives:c:(\d+)$/);
  if (courseSelect) {
    setAdminLivesHubCourse(message.chatId, Number(courseSelect[1]));
    await renderLivesHub(admin, message);
    return true;
  }

  if (data === 'ae:lives:pick' || data.startsWith('ae:lives:pick:')) {
    const page = data === 'ae:lives:pick' ? 0 : Number(data.slice('ae:lives:pick:'.length)) || 0;
    await renderLivesCoursePicker(admin, message, page);
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
