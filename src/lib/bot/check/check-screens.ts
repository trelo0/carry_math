import type { InlineKeyboard } from '@/lib/bot/admin/core';
import type { StaffCourseAssignmentOption } from '@/lib/curator/course-context';
import type { CuratorHomeworkListItem } from '@/lib/bot/staff/curator-homework-screens';
import {
  formatCheckHwWhen,
  type CheckHomeworkListItem,
  type CheckHwListFilters,
} from './check-homework-meta';
import {
  CURATOR_HW_STATUS_LABELS,
  CURATOR_HW_STATUS_SHORT,
  type CuratorHwStatus,
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

export type CheckBotSection = 'hw' | 'stu' | 'msg' | 'lib';

function back(text: string, data: string) {
  return { text, callback_data: data };
}

const SECTION_TITLES: Record<CheckBotSection, string> = {
  hw: '📝 Домашние задания',
  stu: '👥 Ученики',
  msg: '💬 Сообщения',
  lib: '📚 База домашних заданий',
};

const SECTION_PICK_TITLES: Record<CheckBotSection, string> = {
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

export function renderCheckHomeworkHub(
  courseId: number,
  courseTitle: string,
): { text: string; keyboard: InlineKeyboard } {
  return {
    text: `${SECTION_TITLES.hw}\n🎓 ${courseTitle}\n\nВыберите подраздел:`,
    keyboard: {
      inline_keyboard: [
        [back('🔴 На проверку', `k:hw:${courseId}:pend:0`)],
        [back('📁 Архив', `k:hw:${courseId}:a`)],
        [back('⬅️ К выбору курса', 'k:pk:hw')],
      ],
    },
  };
}

export type CheckArchiveFilter = 'all' | 'submitted' | 'approved' | 'revision' | 'waiting' | 'overdue';

const ARCHIVE_FILTER_LABELS: Record<CheckArchiveFilter, string> = {
  all: 'Все',
  submitted: 'На проверке',
  approved: 'Одобрено',
  revision: 'На доработке',
  waiting: 'Не сдано',
  overdue: 'Просрочено',
};

export function renderCheckArchiveFilters(
  courseId: number,
  courseTitle: string,
): { text: string; keyboard: InlineKeyboard } {
  const filters: CheckArchiveFilter[] = ['all', 'submitted', 'approved', 'revision', 'waiting', 'overdue'];
  return {
    text: `📁 Архив ДЗ\n🎓 ${courseTitle}\n\nФильтр по статусу:`,
    keyboard: {
      inline_keyboard: [
        ...filters.map((f) => [back(ARCHIVE_FILTER_LABELS[f], `k:hw:${courseId}:a:${f}`)]),
        [back('⬅️ Назад', `k:hw:${courseId}`)],
      ],
    },
  };
}

function hwListLabel(item: CheckHomeworkListItem): string {
  const short = CURATOR_HW_STATUS_SHORT[item.homework.status];
  const overdue = item.meta?.overdue ? ' ⏱' : '';
  return `${item.studentName} · №${item.homework.number} — ${short}${overdue}`.slice(0, 60);
}

export function encodePendingListCallback(
  courseId: number,
  page: number,
  filters: CheckHwListFilters,
): string {
  let cb = `k:hw:${courseId}:pend:${page}`;
  if (filters.studentTelegramId != null) cb += `:s:${filters.studentTelegramId}`;
  if (filters.moduleIndex != null) cb += `:m:${filters.moduleIndex}`;
  if (filters.lessonNumber != null) cb += `:n:${filters.lessonNumber}`;
  return cb;
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
    }
  }
  return filters;
}

export function renderCheckHomeworkList(
  courseId: number,
  courseTitle: string,
  items: CheckHomeworkListItem[],
  mode: 'pending' | 'archive',
  options?: {
    archiveFilter?: CheckArchiveFilter;
    page?: number;
    totalPages?: number;
    filters?: CheckHwListFilters;
    listCallbackBase?: string;
  },
): { text: string; keyboard: InlineKeyboard } {
  const page = options?.page ?? 0;
  const totalPages = options?.totalPages ?? 1;
  const filters = options?.filters ?? {};
  const title =
    mode === 'pending'
      ? `🔴 На проверку · ${courseTitle}`
      : `📁 Архив (${options?.archiveFilter ? ARCHIVE_FILTER_LABELS[options.archiveFilter] : 'все'}) · ${courseTitle}`;
  const parts = [title, ''];
  if (mode === 'pending') {
    parts.push('🔎 Фильтры: ученик / модуль / занятие — кнопка ниже.', '');
  }
  if (items.length === 0) {
    parts.push('Список пуст.');
  } else {
    parts.push(`Показано: ${items.length} · стр. ${page + 1}/${totalPages}`, '');
    for (const i of items.slice(0, 8)) {
      const meta = i.meta;
      parts.push(
        `• ${i.studentName} · ДЗ №${i.homework.number}`,
        meta
          ? `  ${meta.moduleTitle} · сдача ${formatCheckHwWhen(meta.submittedAt)} · дедлайн ${formatCheckHwWhen(meta.deadlineAt)}${meta.overdue ? ' · ПРОСРОЧКА' : ''}`
          : '',
      );
    }
  }
  const keyboard: InlineKeyboard['inline_keyboard'] = items.map((i) => [
    back(hwListLabel(i), `k:hw:${courseId}:i:${i.studentId}:${i.homework.number}`),
  ]);
  const nav: InlineKeyboard['inline_keyboard'] = [];
  const listCb =
    options?.listCallbackBase ??
    (mode === 'pending' ? encodePendingListCallback(courseId, page, filters) : `k:hw:${courseId}:a`);
  const archiveFilter = options?.archiveFilter;
  if (page > 0) {
    nav.push([
      back(
        '◀️ Назад',
        mode === 'pending'
          ? encodePendingListCallback(courseId, page - 1, filters)
          : `k:hw:${courseId}:a:${archiveFilter ?? 'all'}:${page - 1}`,
      ),
    ]);
  }
  if (page + 1 < totalPages) {
    nav.push([
      back(
        '▶️ Далее',
        mode === 'pending'
          ? encodePendingListCallback(courseId, page + 1, filters)
          : `k:hw:${courseId}:a:${archiveFilter ?? 'all'}:${page + 1}`,
      ),
    ]);
  }
  if (mode === 'pending') {
    keyboard.push([back('🔎 Фильтры', `k:hw:${courseId}:fl:${page}`)]);
    if (filters.studentTelegramId != null || filters.moduleIndex != null || filters.lessonNumber != null) {
      keyboard.push([back('✖️ Сбросить фильтры', `k:hw:${courseId}:pend:0`)]);
    }
  }
  keyboard.push(...nav);
  keyboard.push([
    back('⬅️ Назад', mode === 'pending' ? `k:hw:${courseId}` : `k:hw:${courseId}:a`),
  ]);
  return { text: parts.join('\n'), keyboard: { inline_keyboard: keyboard } };
}

export function renderCheckHwFilterMenu(
  courseId: number,
  page: number,
): { text: string; keyboard: InlineKeyboard } {
  return {
    text: '🔎 Фильтры очереди «На проверку»',
    keyboard: {
      inline_keyboard: [
        [back('👤 По ученику', `k:hw:${courseId}:fl:${page}:s`)],
        [back('📂 По модулю', `k:hw:${courseId}:fl:${page}:m`)],
        [back('📚 По занятию (номер)', `k:hw:${courseId}:fl:${page}:n`)],
        [back('⬅️ К списку', encodePendingListCallback(courseId, page, {}))],
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
  const map: Record<Exclude<CheckArchiveFilter, 'all' | 'overdue'>, CuratorHwStatus> = {
    submitted: 'submitted',
    approved: 'approved',
    revision: 'revision',
    waiting: 'waiting',
  };
  const want = map[filter as Exclude<CheckArchiveFilter, 'all' | 'overdue'>];
  return items.filter((i) => i.homework.status === want);
}

export function renderCheckHomeworkCard(
  courseId: number,
  courseTitle: string,
  student: CuratorStudentRecord,
  homework: CuratorHomeworkRecord,
  options?: { readOnly?: boolean; meta?: import('./check-homework-meta').CheckHwMeta | null },
): { text: string; keyboard: InlineKeyboard } {
  const readOnly = options?.readOnly ?? false;
  const meta = options?.meta;
  const parts = [
    '📝 Домашнее задание',
    '',
    `👨‍🎓 ${student.name}`,
    `🎓 ${courseTitle}`,
    `📚 ${meta?.moduleTitle ? `${meta.moduleTitle} · ` : ''}Занятие №${homework.number}: ${homework.title}`,
    `Статус: ${CURATOR_HW_STATUS_LABELS[homework.status]}`,
  ];
  if (meta) {
    parts.push(
      `Отправлено: ${formatCheckHwWhen(meta.submittedAt)}`,
      `Дедлайн: ${formatCheckHwWhen(meta.deadlineAt)}`,
    );
    if (meta.overdue) parts.push('⏱ Просрочено');
  }
  if (homework.submissionNote?.trim()) {
    parts.push('', 'Комментарий ученика:', homework.submissionNote.trim());
  }
  parts.push('', '📎 Ответ ученика — кнопка «Посмотреть работу».');

  const canReview = homework.status === 'submitted' && !readOnly;
  const canLife =
    !readOnly &&
    (homework.status === 'waiting' || homework.status === 'revision' || homework.status === 'submitted');

  const rows: InlineKeyboard['inline_keyboard'] = [
    [{ text: '👀 Посмотреть работу', callback_data: `k:hw:${courseId}:v:${student.id}:${homework.number}` }],
  ];
  if (canReview) {
    rows.push([{ text: '✅ Одобрить ДЗ', callback_data: `k:hw:${courseId}:ok:${student.id}:${homework.number}` }]);
    rows.push([
      { text: '🔄 На доработку', callback_data: `k:hw:${courseId}:rej:${student.id}:${homework.number}` },
    ]);
  }
  if (!readOnly) {
    rows.push([
      { text: '💬 Комментарий (без смены статуса)', callback_data: `k:hw:${courseId}:cmt:${student.id}:${homework.number}` },
    ]);
  }
  if (canLife) {
    rows.push([
      {
        text: '❤️ Снять жизнь',
        callback_data: `k:life:${courseId}:ask:${student.id}:${homework.number}`,
      },
    ]);
  }
  rows.push([
    { text: '✉️ Связаться с учеником', callback_data: `k:msg:${courseId}:w:${student.telegramId}` },
  ]);
  rows.push([back('⬅️ Назад', `k:hw:${courseId}:pend:0`)]);
  return { text: parts.join('\n'), keyboard: { inline_keyboard: rows } };
}

export function renderCheckRejectMethod(
  courseId: number,
  studentId: string,
  hwNumber: number,
): { text: string; keyboard: InlineKeyboard } {
  return {
    text: '🔄 Возврат на доработку\n\nВыберите способ комментария:',
    keyboard: {
      inline_keyboard: [
        [{ text: '✏️ Текст', callback_data: `k:rej:${courseId}:t:${studentId}:${hwNumber}` }],
        [{ text: '🎤 Голосовое', callback_data: `k:rej:${courseId}:v:${studentId}:${hwNumber}` }],
        [{ text: '📷 Фото', callback_data: `k:rej:${courseId}:p:${studentId}:${hwNumber}` }],
        [{ text: '⏭ Без комментария', callback_data: `k:rej:${courseId}:skip:${studentId}:${hwNumber}` }],
        [back('⬅️ Отмена', `k:hw:${courseId}:i:${studentId}:${hwNumber}`)],
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
): { text: string; keyboard: InlineKeyboard } {
  const after = Math.max(0, livesBefore - 1);
  return {
    text:
      '❤️ Списание жизни\n\n' +
      `Ученик: ${studentName}\n` +
      `Курс: ${courseTitle}\n` +
      `ДЗ №${hwNumber}\n\n` +
      `Жизни: ${livesBefore}${livesMax != null ? `/${livesMax}` : ''} → ${after}${livesMax != null ? `/${livesMax}` : ''}\n\n` +
      'Подтвердите списание:',
    keyboard: {
      inline_keyboard: [
        [{ text: '✅ Подтвердить', callback_data: `k:life:${courseId}:do:${studentId}:${hwNumber}` }],
        [back('⬅️ Отмена', `k:hw:${courseId}:i:${studentId}:${hwNumber}`)],
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
  if (students.length === 0) {
    const emptyText = options?.searchQuery
      ? `👥 Ученики\n🎓 ${courseTitle}\n\nПо запросу «${options.searchQuery}» никого не найдено.`
      : `👥 Ученики\n🎓 ${courseTitle}\n\nНет учеников с доступом к курсу.`;
    return {
      text: emptyText,
      keyboard: {
        inline_keyboard: [
          [back('🔎 Поиск', `k:stu:${courseId}:find`)],
          [back('⬅️ К выбору курса', 'k:pk:stu')],
        ],
      },
    };
  }
  const page = options?.page ?? 0;
  const totalPages = options?.totalPages ?? 1;
  const lines = [
    `👥 Ученики`,
    `🎓 ${courseTitle}`,
    `${students.length} чел.${options?.searchQuery ? ` · поиск: «${options.searchQuery}»` : ''}`,
    `Стр. ${page + 1}/${totalPages}`,
    '',
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
  keyboard.push([back('🔎 Поиск по имени', `k:stu:${courseId}:find`)]);
  keyboard.push([back('⬅️ К выбору курса', 'k:pk:stu')]);
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
        [back('⬅️ К списку', `k:stu:${courseId}`)],
      ],
    },
  };
}

export function renderCheckMessagesInbox(
  courseId: number,
  courseTitle: string,
  threads: StaffThreadSummary[],
  storageEnabled: boolean,
): { text: string; keyboard: InlineKeyboard } {
  const parts = [`💬 Сообщения`, `🎓 ${courseTitle}`, ''];
  if (!storageEnabled) {
    parts.push('История переписки недоступна (миграция staff_student_messages).', '');
  }
  if (threads.length === 0) {
    parts.push('Диалогов с учениками этого курса пока нет.');
  } else {
    parts.push('Выберите диалог:');
  }
  const buttons = threads.map((t) => [
    {
      text: `${t.unreadCount > 0 ? '🔴 ' : ''}${t.studentLabel}`.slice(0, 60),
      callback_data: `k:msg:${courseId}:d:${t.studentTelegramId}`,
    },
  ]);
  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: [
        ...buttons,
        [back('⬅️ К выбору курса', 'k:pk:msg')],
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
    for (const msg of messages) {
      const who = msg.direction === 'student_to_staff' ? '👤 Ученик' : '🧑‍🏫 Вы';
      const time = new Date(msg.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' });
      parts.push(`${who} · ${time}`, msg.body, '');
    }
  }
  return {
    text: parts.join('\n').slice(0, 3900),
    keyboard: {
      inline_keyboard: [
        [{ text: '✏️ Написать', callback_data: `k:msg:${courseId}:w:${studentTelegramId}` }],
        [back('⬅️ К списку', `k:msg:${courseId}`)],
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
      keyboard: { inline_keyboard: [[back('⬅️ К выбору курса', 'k:pk:lib')]] },
    };
  }
  return {
    text: `📚 База домашних заданий\n🎓 ${courseTitle}\n\nВыберите модуль:`,
    keyboard: {
      inline_keyboard: [
        ...modules.map((m) => [back(`📂 ${m.title}`.slice(0, 58), `k:lib:${courseId}:m:${m.index}`)]),
        [back('⬅️ К выбору курса', 'k:pk:lib')],
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
