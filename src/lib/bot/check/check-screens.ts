import type { InlineKeyboard } from '@/lib/bot/admin/core';
import type { StaffCourseAssignmentOption } from '@/lib/curator/course-context';
import {
  formatCheckHwWhen,
  type CheckArchiveStatusFilter,
  type CheckHomeworkListItem,
  type CheckHwListFilters,
} from './check-homework-meta';
import {
  CURATOR_HW_STATUS_LABELS,
  CURATOR_HW_STATUS_SHORT,
} from '@/lib/bot/curator/curator-types';
import type { CuratorStudentRecord, CuratorHomeworkRecord } from '@/lib/bot/curator/curatorData';
import type { CuratorStudentView } from '@/lib/curator/students';
import type { StaffMessageRow, StaffThreadSummary } from '@/lib/bot/staff/messaging';
import type { CheckLibraryModule } from './check-library';
import type { CuratorLibraryTask } from '@/lib/bot/curator/curator-types';

export const CHECK_BOT_WELCOME_TEXT =
  'Кабинет проверяющего ДЗ. Здесь ты можешь проверять работы учеников, отвечать на вопросы и следить за их прогрессом.';

export const CHECK_NO_COURSES_TEXT =
  'Нет курсов с назначением «проверяющий ДЗ».\n\nОбратитесь к администратору, чтобы вас добавили в course_staff_assignments с ролью check.';

export type CheckBotSection = 'home' | 'hw' | 'stu' | 'msg' | 'lib';

function back(text: string, data: string) {
  return { text, callback_data: data };
}

const SECTION_TITLES: Record<CheckBotSection, string> = {
  home: '🏠 Главная',
  hw: '📝 Домашние задания',
  stu: '👥 Ученики',
  msg: '💬 Сообщения',
  lib: '📚 База домашних заданий',
};

const SECTION_PICK_TITLES: Record<CheckBotSection, string> = {
  home: '🏠 Выберите курс',
  hw: '📝 Выберите курс — домашние задания',
  stu: '👥 Выберите курс — ученики',
  msg: '💬 Выберите курс — сообщения',
  lib: '📚 Выберите курс — база ДЗ',
};

export function renderCheckNoCourses(): { text: string; keyboard: InlineKeyboard } {
  return {
    text: CHECK_NO_COURSES_TEXT,
    keyboard: { inline_keyboard: [] },
  };
}

export function renderCheckCoursePicker(
  section: CheckBotSection,
  courses: StaffCourseAssignmentOption[],
): { text: string; keyboard: InlineKeyboard } {
  return {
    text: SECTION_PICK_TITLES[section],
    keyboard: {
      inline_keyboard: [
        ...courses.map((c) => [back(c.title.slice(0, 58), `k:sec:${section}:${c.courseId}`)]),
      ],
    },
  };
}

export function renderCheckHome(
  _courseId: number,
  courseTitle: string,
  stats: { unreadMessages: number; pendingHomework: number },
): { text: string; keyboard: InlineKeyboard } {
  return {
    text:
      `🏠 Главная · проверка ДЗ\n🎓 ${courseTitle}\n\n` +
      `💬 Новых сообщений: ${stats.unreadMessages}\n` +
      `📝 ДЗ на проверку: ${stats.pendingHomework}\n\n` +
      'Разделы — кнопки меню под полем ввода.',
    keyboard: { inline_keyboard: [] },
  };
}

export function renderCheckStudentsHub(
  courseId: number,
  courseTitle: string,
): { text: string; keyboard: InlineKeyboard } {
  return {
    text: `👥 Ученики\n🎓 ${courseTitle}\n\nВыберите действие:`,
    keyboard: {
      inline_keyboard: [
        [back('📋 Список учеников', `k:stu:${courseId}:list`)],
        [back('🔎 Поиск по имени', `k:stu:${courseId}:find`)],
        [back('🏠 На главную', `k:home:${courseId}`)],
      ],
    },
  };
}

export function renderCheckHomeworkHub(
  courseId: number,
  courseTitle: string,
): { text: string; keyboard: InlineKeyboard } {
  return {
    text: `${SECTION_TITLES.hw}\n🎓 ${courseTitle}\n\nВыберите подраздел:`,
    keyboard: {
      inline_keyboard: [
        [back('🔴 На проверку', `k:hw:${courseId}:pend:0`)],
        [back('📁 Архив', `k:hw:${courseId}:arch:0`)],
        [back('🏠 На главную', `k:home:${courseId}`)],
      ],
    },
  };
}

export type CheckArchiveFilter = CheckArchiveStatusFilter;

const ARCHIVE_STATUS_LABELS: Record<CheckArchiveStatusFilter, string> = {
  all: 'Все',
  approved: 'Одобрено',
  revision: 'На доработке',
  overdue: 'Просрочено',
};

export type CheckHwListMode = 'pending' | 'archive';

export type CheckHwListOrigin = {
  mode: CheckHwListMode;
  page: number;
  filters: CheckHwListFilters;
};

function filterSuffix(filters: CheckHwListFilters): string {
  let cb = '';
  if (filters.studentTelegramId != null) cb += `:s:${filters.studentTelegramId}`;
  if (filters.moduleIndex != null) cb += `:m:${filters.moduleIndex}`;
  if (filters.lessonNumber != null) cb += `:n:${filters.lessonNumber}`;
  if (filters.archiveStatus && filters.archiveStatus !== 'all') cb += `:f:${filters.archiveStatus}`;
  return cb;
}

export function encodeListCallback(courseId: number, origin: CheckHwListOrigin): string {
  const mode = origin.mode === 'archive' ? 'arch' : 'pend';
  return `k:hw:${courseId}:${mode}:${origin.page}${filterSuffix(origin.filters)}`;
}

export function encodePendingListCallback(
  courseId: number,
  page: number,
  filters: CheckHwListFilters,
): string {
  return encodeListCallback(courseId, { mode: 'pending', page, filters });
}

export function parseListFilters(parts: string[], startIndex: number): CheckHwListFilters {
  const filters: CheckHwListFilters = {};
  for (let i = startIndex; i < parts.length; i++) {
    if (parts[i] === 's' && parts[i + 1]) {
      filters.studentTelegramId = Number(parts[i + 1]);
      i++;
    } else if (parts[i] === 'm' && parts[i + 1]) {
      filters.moduleIndex = Number(parts[i + 1]);
      i++;
    } else if (parts[i] === 'n' && parts[i + 1]) {
      filters.lessonNumber = Number(parts[i + 1]);
      i++;
    } else if (parts[i] === 'f' && parts[i + 1]) {
      const status = parts[i + 1] as CheckArchiveStatusFilter;
      if (status === 'all' || status === 'approved' || status === 'revision' || status === 'overdue') {
        filters.archiveStatus = status;
      }
      i++;
    }
  }
  return filters;
}

export function parseListOrigin(parts: string[], startIndex: number): CheckHwListOrigin {
  const token = parts[startIndex];
  if (token === 'pend' || token === 'arch' || token === 'a') {
    const mode: CheckHwListMode = token === 'pend' ? 'pending' : 'archive';
    const page = Number(parts[startIndex + 1] ?? 0) || 0;
    return { mode, page, filters: parseListFilters(parts, startIndex + 2) };
  }
  return { mode: 'pending', page: 0, filters: {} };
}

export function originSuffix(origin: CheckHwListOrigin): string {
  const mode = origin.mode === 'archive' ? 'arch' : 'pend';
  return `${mode}:${origin.page}${filterSuffix(origin.filters)}`;
}

export function parseOriginFromParts(parts: string[], startIndex: number): CheckHwListOrigin {
  if (!parts[startIndex]) return { mode: 'pending', page: 0, filters: {} };
  return parseListOrigin(parts, startIndex);
}

function withOrigin(base: string, origin: CheckHwListOrigin): string {
  const full = `${base}:${originSuffix(origin)}`;
  if (full.length <= 64) return full;
  const short = `${base}:${origin.mode === 'archive' ? 'arch' : 'pend'}:${origin.page}`;
  return short.length <= 64 ? short : base;
}

export function encodeHwItemCallback(
  action: 'i' | 'v' | 'ok' | 'rej' | 'cmt' | 'vd',
  courseId: number,
  studentId: string,
  hwNumber: number,
  origin: CheckHwListOrigin,
): string {
  return withOrigin(`k:hw:${courseId}:${action}:${studentId}:${hwNumber}`, origin);
}

export function encodeRejCallback(
  action: 'file' | 'fskip' | 'note' | 'nskip' | 'go' | 'c' | 'skip' | 'bare',
  courseId: number,
  studentId: string,
  hwNumber: number,
  origin: CheckHwListOrigin,
): string {
  return withOrigin(`k:rej:${courseId}:${action}:${studentId}:${hwNumber}`, origin);
}

export function encodeLifeCallback(
  action: 'ask' | 'do',
  courseId: number,
  studentId: string,
  hwNumber: number,
  origin: CheckHwListOrigin,
): string {
  return withOrigin(`k:life:${courseId}:${action}:${studentId}:${hwNumber}`, origin);
}

export function encodeMsgFromHwCallback(
  courseId: number,
  telegramId: number,
  hwNumber: number,
  origin: CheckHwListOrigin,
): string {
  return withOrigin(`k:msg:${courseId}:wh:${telegramId}:${hwNumber}`, origin);
}

function hwListLabel(item: CheckHomeworkListItem, mode: CheckHwListMode): string {
  const overdue = item.meta?.overdue ? '🔴 ' : '';
  const short = mode === 'archive' ? ` — ${CURATOR_HW_STATUS_SHORT[item.homework.status]}` : '';
  return `${overdue}${item.studentName} · №${item.homework.number}${short}`.slice(0, 64);
}

export function renderCheckHomeworkList(
  courseId: number,
  courseTitle: string,
  items: CheckHomeworkListItem[],
  mode: CheckHwListMode,
  options?: {
    page?: number;
    totalPages?: number;
    totalCount?: number;
    filters?: CheckHwListFilters;
  },
): { text: string; keyboard: InlineKeyboard } {
  const page = options?.page ?? 0;
  const totalPages = options?.totalPages ?? 1;
  const filters = options?.filters ?? {};
  const origin: CheckHwListOrigin = { mode, page, filters };
  const title = mode === 'pending' ? `🔴 На проверку · ${courseTitle}` : `📁 Архив · ${courseTitle}`;
  const intro =
    mode === 'pending'
      ? 'Все домашние задания, которые ждут проверки.'
      : 'Проверенные работы: одобрено и на доработке.';
  const parts = [title, '', intro];
  const totalCount = options?.totalCount ?? items.length;
  if (totalCount === 0) {
    parts.push('', 'Список пуст.');
  } else {
    parts.push('', `Всего: ${totalCount} · стр. ${page + 1}/${totalPages}`);
  }
  const keyboard: InlineKeyboard['inline_keyboard'] = items.map((i) => [
    back(hwListLabel(i, mode), encodeHwItemCallback('i', courseId, i.studentId, i.homework.number, origin)),
  ]);
  const nav: InlineKeyboard['inline_keyboard'] = [];
  if (page > 0) {
    nav.push([back('◀️ Назад', encodeListCallback(courseId, { ...origin, page: page - 1 }))]);
  }
  if (page + 1 < totalPages) {
    nav.push([back('▶️ Далее', encodeListCallback(courseId, { ...origin, page: page + 1 }))]);
  }
  const filterPrefix = mode === 'pending' ? 'fl' : 'afl';
  keyboard.push([back('🔎 Фильтры', `k:hw:${courseId}:${filterPrefix}:${page}`)]);
  const hasFilters =
    filters.studentTelegramId != null ||
    filters.moduleIndex != null ||
    filters.lessonNumber != null ||
    (filters.archiveStatus != null && filters.archiveStatus !== 'all');
  if (hasFilters) {
    keyboard.push([
      back('✖️ Сбросить фильтры', encodeListCallback(courseId, { mode, page: 0, filters: {} })),
    ]);
  }
  keyboard.push(...nav);
  keyboard.push([back('⬅️ Назад', `k:hw:${courseId}`)]);
  return { text: parts.join('\n'), keyboard: { inline_keyboard: keyboard } };
}

export function renderCheckHwFilterMenu(
  courseId: number,
  page: number,
  origin: CheckHwListOrigin,
): { text: string; keyboard: InlineKeyboard } {
  const prefix = origin.mode === 'archive' ? 'afl' : 'fl';
  const rows: InlineKeyboard['inline_keyboard'] = [
    [back('👤 По ученику', `k:hw:${courseId}:${prefix}:${page}:s`)],
    [back('📂 По модулю', `k:hw:${courseId}:${prefix}:${page}:m`)],
    [back('📚 По занятию (номер)', `k:hw:${courseId}:${prefix}:${page}:n`)],
  ];
  if (origin.mode === 'archive') {
    rows.push([back('📌 По статусу', `k:hw:${courseId}:${prefix}:${page}:st`)]);
  }
  rows.push([back('⬅️ К списку', encodeListCallback(courseId, origin))]);
  return {
    text: origin.mode === 'archive' ? '🔎 Фильтры архива' : '🔎 Фильтры очереди «На проверку»',
    keyboard: { inline_keyboard: rows },
  };
}

export function renderCheckArchiveStatusFilters(
  courseId: number,
  page: number,
  origin: CheckHwListOrigin,
): { text: string; keyboard: InlineKeyboard } {
  const statuses: CheckArchiveStatusFilter[] = ['all', 'approved', 'revision', 'overdue'];
  return {
    text: '📌 Статус в архиве',
    keyboard: {
      inline_keyboard: [
        ...statuses.map((status) => [
          back(
            ARCHIVE_STATUS_LABELS[status],
            encodeListCallback(courseId, {
              ...origin,
              page: 0,
              filters: { ...origin.filters, archiveStatus: status === 'all' ? undefined : status },
            }),
          ),
        ]),
        [back('⬅️ Назад', `k:hw:${courseId}:afl:${page}`)],
      ],
    },
  };
}

export function filterArchiveItems(
  items: CheckHomeworkListItem[],
  filter: CheckArchiveFilter,
): CheckHomeworkListItem[] {
  if (filter === 'all') return items;
  if (filter === 'overdue') return items.filter((i) => i.meta?.overdue);
  return items.filter((i) => i.homework.status === filter);
}

export function renderCheckHomeworkCard(
  courseId: number,
  courseTitle: string,
  student: CuratorStudentRecord,
  homework: CuratorHomeworkRecord,
  options?: {
    meta?: import('./check-homework-meta').CheckHwMeta | null;
    origin?: CheckHwListOrigin;
    lifeDeducted?: boolean;
  },
): { text: string; keyboard: InlineKeyboard } {
  const meta = options?.meta;
  const origin = options?.origin ?? { mode: 'pending' as const, page: 0, filters: {} };
  const overdue = Boolean(meta?.overdue);
  const parts = [
    '📝 Проверка ДЗ',
    '',
    `👤 Ученик: ${student.name}`,
    `🎓 Курс: ${courseTitle}`,
    `📚 ${meta?.moduleTitle ? `${meta.moduleTitle} · ` : ''}Занятие №${homework.number}: ${homework.title}`,
    `📌 Статус: ${CURATOR_HW_STATUS_LABELS[homework.status]}`,
  ];
  if (meta) {
    parts.push(
      `📤 Отправлено: ${formatCheckHwWhen(meta.submittedAt)}`,
      `⏰ Дедлайн: ${formatCheckHwWhen(meta.deadlineAt)}`,
    );
  }
  if (overdue) {
    parts.push('', '⚠️ СДАНО С ПРОСРОЧКОЙ');
  }
  if (homework.submissionNote?.trim()) {
    parts.push('', '💬 Комментарий ученика:', homework.submissionNote.trim());
  }
  parts.push('', 'Откройте работу ученика, чтобы вынести вердикт.');

  const canLife = overdue && !options?.lifeDeducted && homework.status === 'submitted';
  const rows: InlineKeyboard['inline_keyboard'] = [
    [
      {
        text: '👀 Посмотреть работу',
        callback_data: encodeHwItemCallback('v', courseId, student.id, homework.number, origin),
      },
    ],
    [
      {
        text: '✉️ Связаться с учеником',
        callback_data: encodeMsgFromHwCallback(courseId, student.telegramId, homework.number, origin),
      },
    ],
  ];
  if (canLife) {
    rows.push([
      {
        text: '❤️ Снять жизнь',
        callback_data: encodeLifeCallback('ask', courseId, student.id, homework.number, origin),
      },
    ]);
  }
  rows.push([back('⬅️ Назад', encodeListCallback(courseId, origin))]);
  return { text: parts.join('\n'), keyboard: { inline_keyboard: rows } };
}

export function renderCheckVerdict(
  courseId: number,
  student: CuratorStudentRecord,
  homework: CuratorHomeworkRecord,
  origin: CheckHwListOrigin,
): { text: string; keyboard: InlineKeyboard } {
  const canReview = homework.status === 'submitted';
  const rows: InlineKeyboard['inline_keyboard'] = [];
  if (canReview) {
    rows.push([
      {
        text: '✅ Одобрено',
        callback_data: encodeHwItemCallback('ok', courseId, student.id, homework.number, origin),
      },
    ]);
    rows.push([
      {
        text: '🔄 На доработку',
        callback_data: encodeHwItemCallback('rej', courseId, student.id, homework.number, origin),
      },
    ]);
  }
  rows.push([
    {
      text: '💬 Комментарий без смены статуса',
      callback_data: encodeHwItemCallback('cmt', courseId, student.id, homework.number, origin),
    },
  ]);
  rows.push([
    back('⬅️ Назад', encodeHwItemCallback('i', courseId, student.id, homework.number, origin)),
  ]);
  return {
    text:
      '⚖️ Ваш вердикт\n\n' +
      `👤 ${student.name}\n` +
      `📚 ДЗ №${homework.number}: ${homework.title}\n\n` +
      (canReview ? 'Выберите решение:' : 'Работа уже проверена. Можно оставить комментарий.'),
    keyboard: { inline_keyboard: rows },
  };
}

export function renderCheckRejectFilePrompt(
  courseId: number,
  studentId: string,
  hwNumber: number,
  origin: CheckHwListOrigin,
): { text: string; keyboard: InlineKeyboard } {
  return {
    text:
      '🔄 Пояснение к доработке · шаг 1/2\n\n' +
      'Приложите файл или фото (необязательно).\n' +
      'Можно пропустить и сразу добавить комментарий.',
    keyboard: {
      inline_keyboard: [
        [{ text: '⏭ Пропустить', callback_data: encodeRejCallback('fskip', courseId, studentId, hwNumber, origin) }],
        [back('⬅️ Назад', encodeHwItemCallback('vd', courseId, studentId, hwNumber, origin))],
        [back('❌ Отмена', encodeHwItemCallback('vd', courseId, studentId, hwNumber, origin))],
      ],
    },
  };
}

export function renderCheckRejectNotePrompt(
  courseId: number,
  studentId: string,
  hwNumber: number,
  origin: CheckHwListOrigin,
): { text: string; keyboard: InlineKeyboard } {
  return {
    text:
      '🔄 Пояснение к доработке · шаг 2/2\n\n' +
      'Добавьте комментарий: текст или голосовое (необязательно).\n' +
      'Можно пропустить и сразу открыть черновик.',
    keyboard: {
      inline_keyboard: [
        [{ text: '⏭ Пропустить', callback_data: encodeRejCallback('nskip', courseId, studentId, hwNumber, origin) }],
        [back('⬅️ Назад', encodeRejCallback('file', courseId, studentId, hwNumber, origin))],
        [back('❌ Отмена', encodeHwItemCallback('vd', courseId, studentId, hwNumber, origin))],
      ],
    },
  };
}

/** @deprecated старый экран метода — оставлен для совместимости callback. */
export function renderCheckRejectMethod(
  courseId: number,
  studentId: string,
  hwNumber: number,
  origin: CheckHwListOrigin,
): { text: string; keyboard: InlineKeyboard } {
  return renderCheckRejectFilePrompt(courseId, studentId, hwNumber, origin);
}

export function renderCheckRejectCommentPrompt(
  courseId: number,
  studentId: string,
  hwNumber: number,
  origin: CheckHwListOrigin,
): { text: string; keyboard: InlineKeyboard } {
  return renderCheckRejectNotePrompt(courseId, studentId, hwNumber, origin);
}

export function renderCheckRejectDraftConfirm(
  courseId: number,
  studentId: string,
  hwNumber: number,
  origin: CheckHwListOrigin,
  draft: {
    text?: string | null;
    fileKind?: 'photo' | 'voice' | 'document' | null;
    voiceAttached?: boolean;
  },
): { text: string; keyboard: InlineKeyboard } {
  const lines = ['📄 Черновик пояснения', ''];
  const raw = draft.text?.trim() ?? '';
  const placeholder =
    !raw ||
    raw === 'Голосовой комментарий' ||
    raw === 'Комментарий на фото' ||
    raw === 'Комментарий в файле';
  if (!placeholder) {
    lines.push('📝 Текст:', raw, '');
  }
  const attach: string[] = [];
  if (draft.fileKind === 'photo') attach.push('🖼 фото (выше)');
  if (draft.fileKind === 'document') attach.push('📎 файл (выше)');
  if (draft.fileKind === 'voice' && !draft.voiceAttached) attach.push('🎤 голосовое (выше)');
  if (draft.voiceAttached) attach.push('🎤 голосовое (выше)');
  if (attach.length) {
    lines.push('Вложения:', ...attach.map((a) => `• ${a}`), '');
  } else if (placeholder) {
    lines.push('Без текста и без вложений.', '');
  }
  lines.push('Отправить работу на доработку?');
  return {
    text: lines.join('\n'),
    keyboard: {
      inline_keyboard: [
        [{ text: '✅ Подтвердить', callback_data: encodeRejCallback('go', courseId, studentId, hwNumber, origin) }],
        [back('⬅️ Назад', encodeRejCallback('note', courseId, studentId, hwNumber, origin))],
        [back('❌ Отмена', encodeHwItemCallback('vd', courseId, studentId, hwNumber, origin))],
      ],
    },
  };
}

export function renderCheckRejectSkipConfirm(
  courseId: number,
  studentId: string,
  hwNumber: number,
  origin: CheckHwListOrigin,
): { text: string; keyboard: InlineKeyboard } {
  return {
    text: '🔄 Отправить на доработку без комментария?',
    keyboard: {
      inline_keyboard: [
        [{ text: '✅ Подтвердить', callback_data: encodeRejCallback('bare', courseId, studentId, hwNumber, origin) }],
        [back('⬅️ Назад', encodeHwItemCallback('rej', courseId, studentId, hwNumber, origin))],
      ],
    },
  };
}

export function renderCheckLifeConfirm(
  courseId: number,
  courseTitle: string,
  studentName: string,
  hwNumber: number,
  studentId: string,
  livesBefore: number,
  livesMax: number | null,
  origin: CheckHwListOrigin,
): { text: string; keyboard: InlineKeyboard } {
  const after = Math.max(0, livesBefore - 1);
  return {
    text:
      '❤️ Списание жизни\n\n' +
      `Ученик: ${studentName}\n` +
      `Курс: ${courseTitle}\n` +
      `ДЗ №${hwNumber}\n\n` +
      `Жизни: ${livesBefore}${livesMax != null ? `/${livesMax}` : ''} → ${after}${livesMax != null ? `/${livesMax}` : ''}\n\n` +
      'Подтвердите списание. После этого работу всё равно нужно проверить.',
    keyboard: {
      inline_keyboard: [
        [{ text: '✅ Подтвердить', callback_data: encodeLifeCallback('do', courseId, studentId, hwNumber, origin) }],
        [back('⬅️ Назад', encodeHwItemCallback('i', courseId, studentId, hwNumber, origin))],
      ],
    },
  };
}

export function renderCheckStudentsList(
  courseId: number,
  courseTitle: string,
  students: CuratorStudentView[],
  options?: { page?: number; totalPages?: number; searchQuery?: string | null },
): { text: string; keyboard: InlineKeyboard } {
  const searching = Boolean(options?.searchQuery);
  if (students.length === 0) {
    const emptyText = searching
      ? `👥 Поиск\n🎓 ${courseTitle}\n\nПо запросу «${options?.searchQuery}» никого не найдено.`
      : `👥 Ученики\n🎓 ${courseTitle}\n\nНет учеников с доступом к курсу.`;
    return {
      text: emptyText,
      keyboard: {
        inline_keyboard: [[back('⬅️ Назад', `k:stu:${courseId}`)]],
      },
    };
  }
  const page = options?.page ?? 0;
  const totalPages = options?.totalPages ?? 1;
  const lines = [
    searching ? `🔎 Совпадения · «${options?.searchQuery}»` : '👥 Список учеников',
    `🎓 ${courseTitle}`,
    `${students.length} чел.`,
    `Стр. ${page + 1}/${totalPages}`,
  ];
  const keyboard: InlineKeyboard['inline_keyboard'] = students.map((s) => [
    back(`${s.name}`.slice(0, 58), `k:stu:${courseId}:s:${s.telegramId}`),
  ]);
  if (page > 0) {
    keyboard.push([back('◀️ Назад', `k:stu:${courseId}:pg:${page - 1}`)]);
  }
  if (page + 1 < totalPages) {
    keyboard.push([back('▶️ Далее', `k:stu:${courseId}:pg:${page + 1}`)]);
  }
  keyboard.push([back('⬅️ Назад', `k:stu:${courseId}`)]);
  return { text: lines.join('\n'), keyboard: { inline_keyboard: keyboard } };
}

export function renderCheckStudentCard(
  courseId: number,
  courseTitle: string,
  student: CuratorStudentView,
): { text: string; keyboard: InlineKeyboard } {
  const hw = student.homeworks ?? [];
  const submitted = hw.filter((h) => h.status === 'submitted').length;
  const approved = hw.filter((h) => h.status === 'approved').length;
  const revision = hw.filter((h) => h.status === 'revision').length;
  const waiting = hw.filter((h) => h.status === 'waiting').length;

  const accessLine = student.fullyBlocked
    ? '🔒 Полная блокировка'
    : student.accessBlocked
      ? '⏸️ Заморожен (0 жизней)'
      : '✅ Активный доступ';

  const lines = [
    `👨‍🎓 ${student.name}`,
    `🎓 ${courseTitle}`,
    '',
    accessLine,
    `📊 Прогресс: ${student.progressPercent}% (${student.completedLessons}/${student.totalLessons})`,
    `❤️ Жизни: ${student.livesCurrent ?? '—'}${student.livesMax != null ? `/${student.livesMax}` : ''}`,
    '',
    '📝 Домашние задания (по занятиям, без учёта попыток):',
    `• На проверке: ${submitted}`,
    `• Одобрено: ${approved}`,
    `• На доработке: ${revision}`,
    `• Не сдано: ${waiting}`,
    `• Просрочено: ${student.overdueHomeworkCount}`,
  ];
  return {
    text: lines.join('\n'),
    keyboard: {
      inline_keyboard: [
        [{ text: '✉️ Связаться с учеником', callback_data: `k:msg:${courseId}:w:${student.telegramId}` }],
        [back('⬅️ Назад', `k:stu:${courseId}:list`)],
      ],
    },
  };
}

export function renderCheckMessagesHub(
  courseId: number,
  courseTitle: string,
  incomingCount: number,
): { text: string; keyboard: InlineKeyboard } {
  return {
    text:
      `💬 Сообщения\n🎓 ${courseTitle}\n\n` +
      `Входящие (ждут ответа): ${incomingCount}`,
    keyboard: {
      inline_keyboard: [
        [back('📥 Входящие', `k:msg:${courseId}:in`)],
        [back('💬 Диалоги', `k:msg:${courseId}:dlg`)],
        [back('🏠 На главную', `k:home:${courseId}`)],
      ],
    },
  };
}

export function renderCheckMessagesInbox(
  courseId: number,
  courseTitle: string,
  threads: StaffThreadSummary[],
  storageEnabled: boolean,
  mode: 'incoming' | 'dialogs' = 'dialogs',
): { text: string; keyboard: InlineKeyboard } {
  const title = mode === 'incoming' ? '📥 Входящие' : '💬 Диалоги';
  const parts = [title, `🎓 ${courseTitle}`, ''];
  if (!storageEnabled) {
    parts.push('История переписки недоступна (миграция staff_student_messages).', '');
  }
  if (threads.length === 0) {
    parts.push(mode === 'incoming' ? 'Нет новых сообщений.' : 'Диалогов пока нет.');
  } else if (mode === 'incoming') {
    parts.push('Последнее сообщение ученика — выберите, чтобы ответить:');
  } else {
    parts.push('Выберите ученика — откроется вся переписка:');
  }
  const buttons = threads.map((t) => {
    const preview = t.lastBody.replace(/\s+/g, ' ').trim().slice(0, 28);
    const prefix = mode === 'incoming' ? '🔴 ' : '';
    const label = `${prefix}${t.studentLabel}: ${preview || '…'}`.slice(0, 60);
    const cb =
      mode === 'incoming'
        ? `k:msg:${courseId}:in:${t.studentTelegramId}`
        : `k:msg:${courseId}:d:${t.studentTelegramId}`;
    return [{ text: label, callback_data: cb }];
  });
  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: [...buttons, [back('⬅️ Назад', `k:msg:${courseId}`)]],
    },
  };
}

export function renderCheckIncomingPreview(
  courseId: number,
  courseTitle: string,
  studentLabel: string,
  studentTelegramId: number,
  lastBody: string,
  lastAt: string,
): { text: string; keyboard: InlineKeyboard } {
  const time = new Date(lastAt).toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' });
  return {
    text: [
      '📥 Входящее',
      `🎓 ${courseTitle}`,
      '',
      `👤 ${studentLabel}`,
      `🕐 ${time}`,
      '',
      lastBody.trim() || '(без текста)',
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [{ text: '✏️ Ответить', callback_data: `k:msg:${courseId}:w:${studentTelegramId}` }],
        [{ text: '💬 Посмотреть диалог', callback_data: `k:msg:${courseId}:d:${studentTelegramId}` }],
        [{ text: '✅ Закрыть', callback_data: `k:msg:${courseId}:in:${studentTelegramId}:ok` }],
        [back('⬅️ Назад', `k:msg:${courseId}:in`)],
      ],
    },
  };
}

export function renderCheckMessageThread(
  courseId: number,
  courseTitle: string,
  studentLabel: string,
  messages: StaffMessageRow[],
  storageEnabled: boolean,
  studentTelegramId: number,
): { text: string; keyboard: InlineKeyboard } {
  const parts = [`💬 ${studentLabel}`, `🎓 ${courseTitle}`, ''];
  if (!storageEnabled) {
    parts.push('История не сохранена. Ответ уйдёт ученику через бота.', '');
  } else if (messages.length === 0) {
    parts.push('Сообщений в истории пока нет.', '');
  } else {
    parts.push('───────────────', '');
    for (const msg of messages) {
      const inbound = msg.direction === 'student_to_staff';
      const who = inbound ? '👤 Ученик' : '✅ Проверяющий';
      const time = new Date(msg.createdAt).toLocaleString('ru-RU', {
        timeZone: 'Europe/Minsk',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const attach =
        msg.attachmentRef?.startsWith('tg:') && msg.attachmentKind
          ? `\n📎 ${msg.attachmentKind === 'voice' ? 'голосовое' : msg.attachmentKind === 'photo' ? 'фото' : 'файл'}`
          : '';
      parts.push(
        inbound ? '┌─ входящее ─' : '┌─ ваш ответ ─',
        `${who} · ${time}`,
        `${msg.body.trim() || '(без текста)'}${attach}`,
        '└─────────────',
        '',
      );
    }
  }
  return {
    text: parts.join('\n').slice(0, 3900),
    keyboard: {
      inline_keyboard: [
        [{ text: '✏️ Ответить', callback_data: `k:msg:${courseId}:w:${studentTelegramId}` }],
        [back('⬅️ К диалогам', `k:msg:${courseId}:dlg`)],
        [back('⬅️ В сообщения', `k:msg:${courseId}`)],
      ],
    },
  };
}

export function renderCheckLibraryModules(
  courseId: number,
  courseTitle: string,
  modules: CheckLibraryModule[],
): { text: string; keyboard: InlineKeyboard } {
  if (modules.length === 0) {
    return {
      text: `📚 База ДЗ\n🎓 ${courseTitle}\n\nМатериалы домашних заданий не опубликованы.`,
      keyboard: { inline_keyboard: [[back('🏠 На главную', `k:home:${courseId}`)]] },
    };
  }
  return {
    text: `📚 База домашних заданий\n🎓 ${courseTitle}\n\nВыберите модуль:`,
    keyboard: {
      inline_keyboard: [
        ...modules.map((m) => [back(`📂 ${m.title}`.slice(0, 58), `k:lib:${courseId}:m:${m.index}`)]),
        [back('🏠 На главную', `k:home:${courseId}`)],
      ],
    },
  };
}

export function renderCheckLibraryWebinars(
  courseId: number,
  moduleTitle: string,
  moduleIndex: number,
  webinars: { id: string; title: string }[],
): { text: string; keyboard: InlineKeyboard } {
  return {
    text: `📂 ${moduleTitle}\n\nВыберите вебинар:`,
    keyboard: {
      inline_keyboard: [
        ...webinars.map((w) => [back(w.title.slice(0, 58), `k:lib:${courseId}:w:${moduleIndex}:${w.id}`)]),
        [back('⬅️ К модулям', `k:lib:${courseId}`)],
      ],
    },
  };
}

export function renderCheckLibraryTasks(
  courseId: number,
  webinarTitle: string,
  tasks: CuratorLibraryTask[],
  moduleIndex: number,
): { text: string; keyboard: InlineKeyboard } {
  const parts = [`📚 ${webinarTitle}`, '', 'Материалы (только просмотр):', ''];
  for (const t of tasks) {
    parts.push(`• ${t.title}`, t.condition.slice(0, 500), t.fileUrl ? `🔗 ${t.fileUrl}` : '', '');
  }
  const rows: InlineKeyboard['inline_keyboard'] = tasks
    .filter((t) => t.fileUrl?.startsWith('http'))
    .map((t) => [{ text: `🔗 ${t.title}`.slice(0, 58), url: t.fileUrl! }]);
  rows.push([back('⬅️ К вебинарам', `k:lib:${courseId}:m:${moduleIndex}`)]);
  return { text: parts.join('\n').slice(0, 3900), keyboard: { inline_keyboard: rows } };
}
