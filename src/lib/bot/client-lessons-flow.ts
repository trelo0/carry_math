import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { resolveLessonFileDownloadUrl } from '@/lib/lesson-file-download';
import { formatLessonDateTime } from '@/lib/teacher/format';
import {
  clientHomeButton,
  deliverClientHubScreen,
  editHubMessage,
  loadClientHub,
  saveClientHub,
  sendHubMessage,
  type ClientHubDeliverOptions,
} from './client-nav';
import { resolveClientState, type ClientStateSnapshot } from './client-state';
import {
  fetchClientLessonDetail,
  fetchClientPackages,
  fetchFutureClientLessons,
  fetchNextClientLesson,
  fetchPastClientLessons,
  formatClientLessonLine,
  formatClientPaymentStatus,
  formatScheduleDayHeader,
  homeworkStatusLabel,
  kindLabel,
  type ClientLessonDetail,
  type ClientLessonSummary,
} from './client-lessons-data';

type ListContext = 'menu' | 'next' | 'future' | 'past' | 'sched';

const PAST_PAGE_SIZE = 8;

function parseCtx(code: string): ListContext {
  if (code === 'menu' || code === 'next' || code === 'future' || code === 'past' || code === 'sched') return code;
  return 'menu';
}

function backCallback(ctx: ListContext, pastPage?: number): string {
  if (ctx === 'past' && pastPage != null) return `cl:less:p:${pastPage}`;
  if (ctx === 'next') return 'cl:less:next';
  if (ctx === 'future') return 'cl:less:future';
  if (ctx === 'sched') return 'cl:sched:menu';
  return 'cl:less:menu';
}

function backLabel(ctx: ListContext): string {
  switch (ctx) {
    case 'next':
      return '◀️ К ближайшему';
    case 'future':
      return '◀️ К будущим';
    case 'past':
      return '◀️ К прошедшим';
    case 'sched':
      return '◀️ К расписанию';
    default:
      return '◀️ К занятиям';
  }
}

async function renderHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  messageId: number | undefined,
  screenId: string,
  text: string,
  keyboard: { inline_keyboard: Array<Array<Record<string, string>>> },
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const editAt = messageId ? { chatId, messageId } : deliver?.editAt;
  await deliverClientHubScreen(admin, telegramId, chatId, screenId, text, keyboard, {
    ...deliver,
    editAt,
    forcePush: deliver?.forcePush ?? false,
  });
}

function lessonCardText(lesson: ClientLessonDetail, upcoming: boolean): string {
  const { date, time } = formatLessonDateTime(lesson.startsAt);
  const lines = [
    upcoming ? '📅 Ближайшее занятие' : '📅 Занятие',
    '',
    lesson.topic,
    '',
    `Дата: ${date}`,
    `Время: ${time}`,
    `Формат: ${kindLabel(lesson.kind)}`,
  ];
  if (lesson.teacherName) lines.push(`Преподаватель: ${lesson.teacherName}`);
  lines.push(`Оплата: ${formatClientPaymentStatus(lesson.isPaid)}`);
  if (lesson.lessonPlan?.trim()) {
    lines.push('', `План: ${lesson.lessonPlan.trim()}`);
  }
  if (lesson.materialsCount > 0) {
    lines.push('', `Материалы: ${lesson.materialsCount} файл(ов)`);
  } else {
    lines.push('', 'Материалы пока не добавлены.');
  }
  if (lesson.homework) {
    lines.push('', `Домашнее задание: ${lesson.homework.fileName}`);
    lines.push(`Статус: ${homeworkStatusLabel(lesson.homework.reviewStatus)}`);
  }
  if (upcoming && lesson.meetUrl) {
    lines.push('', 'Ссылка на встречу доступна в кнопке ниже.');
  } else if (upcoming && !lesson.meetUrl) {
    lines.push('', 'Ссылка на встречу появится ближе к началу занятия.');
  }
  return lines.join('\n');
}

function lessonCardKeyboard(
  lesson: ClientLessonDetail,
  ctx: ListContext,
  pastPage?: number,
): { inline_keyboard: Array<Array<Record<string, string>>> } {
  const rows: Array<Array<Record<string, string>>> = [];
  const upcoming = lesson.status === 'scheduled' && new Date(lesson.startsAt).getTime() >= Date.now();

  if (upcoming && lesson.meetUrl) {
    rows.push([{ text: '🔗 Открыть ссылку на встречу', url: lesson.meetUrl }]);
  }
  if (lesson.materialsCount > 0) {
    rows.push([{ text: '📎 Материалы занятия', callback_data: `cl:less:mat:${lesson.id}` }]);
  }
  if (lesson.homework) {
    rows.push([{ text: '📝 Домашнее задание', callback_data: `cl:hw:open:${lesson.id}` }]);
  }
  rows.push([{ text: backLabel(ctx), callback_data: backCallback(ctx, pastPage) }]);
  rows.push([clientHomeButton()]);
  return { inline_keyboard: rows };
}

async function sendLessonMaterials(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  lessonId: number,
): Promise<void> {
  const { data, error } = await admin
    .from('lesson_materials')
    .select('id, file_name')
    .eq('lesson_id', lessonId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  if (!data?.length) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'Материалы пока не добавлены.',
    });
    return;
  }

  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: '📎 Материалы занятия:',
  });

  for (const row of data) {
    const fileId = row.id as number;
    const fileName = row.file_name as string;
    const url = await resolveLessonFileDownloadUrl(admin, {
      telegramId,
      lessonId,
      fileId,
      kind: 'material',
    });
    if (url) {
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: `${fileName}\n${url}`,
      });
    }
  }
}

export function isClientLessonsCallback(data: string): boolean {
  return data.startsWith('cl:less:') || data.startsWith('cl:sched:');
}

export async function showClientLessonsMenu(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  stateHint?: ClientStateSnapshot,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const state = stateHint ?? (await resolveClientState(admin, telegramId));
  const [next, future, past] = await Promise.all([
    fetchNextClientLesson(admin, telegramId),
    fetchFutureClientLessons(admin, telegramId, 1),
    fetchPastClientLessons(admin, telegramId, { page: 0, pageSize: 1 }),
  ]);

  const hasPast = past.items.length > 0 || past.hasMore;
  const hasFuture = future.length > 0;
  const hasNext = Boolean(next);
  const noActive = !state.hasActiveProducts && !hasNext && !hasFuture && !hasPast;

  if (noActive && state.phase === 'client_idle') {
    await renderHub(
      admin,
      telegramId,
      chatId,
      undefined,
      'lessons-menu-empty',
      ['📚 Мои занятия', '', 'У вас пока нет активного обучения.'].join('\n'),
      {
        inline_keyboard: [[{ text: '🎓 Купить обучение', callback_data: 'cl:buy:hub' }], [clientHomeButton()]],
      },
      deliver,
    );
    return;
  }

  const text =
    '📚 Мои занятия\n\n' +
    'Выберите подраздел: ближайшее, будущие или прошедшие занятия.';

  const rows: Array<Array<Record<string, string>>> = [
    [{ text: '⏭ Ближайшее', callback_data: 'cl:less:next' }],
    [{ text: '📆 Будущие', callback_data: 'cl:less:future' }],
    [{ text: '📚 Прошедшие', callback_data: 'cl:less:p:0' }],
    [clientHomeButton()],
  ];

  const subtitle =
    !hasNext && !hasFuture && !hasPast
      ? '\n\nПока нет занятий — разделы ниже откроются, когда появятся уроки.'
      : '';

  await renderHub(
    admin,
    telegramId,
    chatId,
    undefined,
    'lessons-menu',
    text + subtitle,
    { inline_keyboard: rows },
    deliver,
  );
}

export async function showClientScheduleMenu(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const lessons = await fetchFutureClientLessons(admin, telegramId, 25);
  if (lessons.length === 0) {
    await renderHub(
      admin,
      telegramId,
      chatId,
      undefined,
      'schedule-empty',
      '🗓 Расписание\n\nБлижайших занятий пока нет.',
      { inline_keyboard: [[clientHomeButton()]] },
      deliver,
    );
    return;
  }

  const groups = new Map<string, ClientLessonSummary[]>();
  for (const lesson of lessons) {
    const key = formatScheduleDayHeader(lesson.startsAt);
    const list = groups.get(key) ?? [];
    list.push(lesson);
    groups.set(key, list);
  }

  const lines = ['🗓 Расписание занятий', ''];
  const keyboardRows: Array<Array<Record<string, string>>> = [];

  for (const [day, dayLessons] of groups) {
    lines.push(day);
    for (const lesson of dayLessons) {
      const { time } = formatLessonDateTime(lesson.startsAt);
      lines.push(`${time} — ${lesson.topic}`);
      lines.push(`${kindLabel(lesson.kind)}${lesson.teacherName ? ` · ${lesson.teacherName}` : ''}`);
      lines.push(formatClientPaymentStatus(lesson.isPaid));
      lines.push('');
      keyboardRows.push([
        {
          text: `Открыть · ${time}`,
          callback_data: `cl:less:v:${lesson.id}:sched`,
        },
      ]);
    }
  }

  keyboardRows.push([clientHomeButton()]);
  await renderHub(admin, telegramId, chatId, undefined, 'schedule-list', lines.join('\n').trim(), {
    inline_keyboard: keyboardRows,
  }, deliver);
}

export async function showClientPackageMenu(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const packages = await fetchClientPackages(admin, telegramId);
  if (packages.length === 0) {
    await renderHub(
      admin,
      telegramId,
      chatId,
      undefined,
      'package-empty',
      '📦 Мой пакет\n\nАктивных пакетов занятий не найдено.',
      { inline_keyboard: [[clientHomeButton()]] },
      deliver,
    );
    return;
  }

  const blocks = packages.map((pkg) => {
    const productLabel = pkg.product === 'individual' ? 'Индивидуальные занятия' : 'Групповые занятия';
    const statusLabel =
      pkg.status === 'active'
        ? 'Активен'
        : pkg.status === 'completed'
          ? 'Завершён'
          : pkg.status;
    return [
      `📦 ${pkg.title}`,
      productLabel,
      '',
      `Всего: ${pkg.total}`,
      `Использовано: ${pkg.used}`,
      `Осталось: ${pkg.remaining}`,
      `Статус: ${statusLabel}`,
    ].join('\n');
  });

  const text = ['📦 Мой пакет занятий', '', ...blocks].join('\n\n');
  await renderHub(admin, telegramId, chatId, undefined, 'package-list', text, {
    inline_keyboard: [[clientHomeButton()]],
  }, deliver);
}

async function showLessonById(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  messageId: number,
  lessonId: number,
  ctx: ListContext,
  pastPage?: number,
): Promise<void> {
  const lesson = await fetchClientLessonDetail(admin, telegramId, lessonId);
  if (!lesson) {
    await editHubMessage(
      { chatId, messageId },
      'Занятие не найдено или недоступно.',
      { inline_keyboard: [[clientHomeButton()]] },
    );
    return;
  }
  const upcoming = lesson.status === 'scheduled';
  await renderHub(
    admin,
    telegramId,
    chatId,
    messageId,
    `lesson-${lessonId}-${ctx}`,
    lessonCardText(lesson, upcoming),
    lessonCardKeyboard(lesson, ctx, pastPage),
  );
}

async function showNextLesson(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  messageId: number,
): Promise<void> {
  const next = await fetchNextClientLesson(admin, telegramId);
  if (!next) {
    await renderHub(
      admin,
      telegramId,
      chatId,
      messageId,
      'lessons-next-empty',
      '⏭ Ближайшее\n\nНет запланированных занятий.',
      {
        inline_keyboard: [
          [{ text: '◀️ К занятиям', callback_data: 'cl:less:menu' }],
          [clientHomeButton()],
        ],
      },
    );
    return;
  }
  await showLessonById(admin, telegramId, chatId, messageId, next.id, 'next');
}

async function showFutureList(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  messageId: number,
): Promise<void> {
  const lessons = await fetchFutureClientLessons(admin, telegramId);
  if (lessons.length === 0) {
    await renderHub(
      admin,
      telegramId,
      chatId,
      messageId,
      'lessons-future-empty',
      '📆 Будущие занятия\n\nСписок пуст.',
      {
        inline_keyboard: [
          [{ text: '◀️ К занятиям', callback_data: 'cl:less:menu' }],
          [clientHomeButton()],
        ],
      },
    );
    return;
  }

  const lines = ['📆 Будущие занятия', ''];
  const rows: Array<Array<Record<string, string>>> = [];
  for (const lesson of lessons) {
    lines.push(formatClientLessonLine(lesson));
    rows.push([
      {
        text: `Открыть · ${formatLessonDateTime(lesson.startsAt).time}`,
        callback_data: `cl:less:v:${lesson.id}:future`,
      },
    ]);
  }
  rows.push([{ text: '◀️ К занятиям', callback_data: 'cl:less:menu' }], [clientHomeButton()]);

  await renderHub(admin, telegramId, chatId, messageId, 'lessons-future', lines.join('\n'), {
    inline_keyboard: rows,
  });
}

async function showPastList(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  messageId: number,
  page: number,
): Promise<void> {
  const { items, hasMore } = await fetchPastClientLessons(admin, telegramId, {
    page,
    pageSize: PAST_PAGE_SIZE,
  });
  if (items.length === 0) {
    await renderHub(
      admin,
      telegramId,
      chatId,
      messageId,
      'lessons-past-empty',
      '📚 Прошедшие занятия\n\nИстория пока пуста.',
      {
        inline_keyboard: [
          [{ text: '◀️ К занятиям', callback_data: 'cl:less:menu' }],
          [clientHomeButton()],
        ],
      },
    );
    return;
  }

  const lines = ['📚 Прошедшие занятия', ''];
  const rows: Array<Array<Record<string, string>>> = [];
  for (const lesson of items) {
    lines.push(formatClientLessonLine(lesson));
    rows.push([
      {
        text: `Открыть · ${formatLessonDateTime(lesson.startsAt).date}`,
        callback_data: `cl:less:v:${lesson.id}:past:${page}`,
      },
    ]);
  }

  const nav: Array<Record<string, string>> = [];
  if (page > 0) nav.push({ text: '◀️ Раньше', callback_data: `cl:less:p:${page - 1}` });
  if (hasMore) nav.push({ text: 'Позже ▶️', callback_data: `cl:less:p:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: '◀️ К занятиям', callback_data: 'cl:less:menu' }], [clientHomeButton()]);

  await renderHub(admin, telegramId, chatId, messageId, `lessons-past-${page}`, lines.join('\n'), {
    inline_keyboard: rows,
  });
}

export async function handleClientLessonsCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!isClientLessonsCallback(data)) return false;

  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }

  if (data === 'cl:less:menu') {
    await showClientLessonsMenu(admin, telegramId, chatId);
    return true;
  }

  if (data === 'cl:sched:menu') {
    await showClientScheduleMenu(admin, telegramId, chatId);
    return true;
  }

  if (data === 'cl:less:next') {
    await showNextLesson(admin, telegramId, chatId, messageId);
    return true;
  }

  if (data === 'cl:less:future') {
    await showFutureList(admin, telegramId, chatId, messageId);
    return true;
  }

  if (data.startsWith('cl:less:p:')) {
    const page = Number(data.slice('cl:less:p:'.length));
    await showPastList(admin, telegramId, chatId, messageId, Number.isFinite(page) ? page : 0);
    return true;
  }

  if (data === 'cl:less:empty') {
    return true;
  }

  const viewMatch = data.match(/^cl:less:v:(\d+):(\w+)(?::(\d+))?$/);
  if (viewMatch) {
    const lessonId = Number(viewMatch[1]);
    const ctx = parseCtx(viewMatch[2]);
    const pastPage = viewMatch[3] != null ? Number(viewMatch[3]) : undefined;
    await showLessonById(admin, telegramId, chatId, messageId, lessonId, ctx, pastPage);
    return true;
  }

  if (data.startsWith('cl:less:mat:')) {
    const lessonId = Number(data.slice('cl:less:mat:'.length));
    if (Number.isFinite(lessonId)) {
      await sendLessonMaterials(admin, telegramId, chatId, lessonId);
    }
    return true;
  }

  return false;
}
