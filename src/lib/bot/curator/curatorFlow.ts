import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  type AdminMessage,
  type AdminPayload,
  type InlineButton,
  type InlineKeyboard,
  type ReplyKeyboard,
  clearStateIfAvailable,
  editAdminMessage,
  getState,
  isConversationStateTableError,
  migrationText,
  saveState,
  sendAdminMessage,
} from '../admin/core';
import { CURATOR_HW_STATUS_LABELS, CURATOR_HW_STATUS_SHORT } from './curator-types';
import {
  getCuratorHomeworkRecord,
  getCuratorNotificationById,
  getCuratorStudentRecord,
  isCuratorNotificationRead,
  listCuratorStudentLabel,
  listCuratorSubmissionNotifications,
  loadCuratorStudentsForBot,
  resolveCuratorBotCourseScope,
  markCuratorNotificationRead,
  summarizeCuratorStudent,
  summarizeCuratorStudents,
  type CuratorHomeworkRecord,
  type CuratorStudentRecord,
} from './curatorData';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import { loadStaffCapabilities } from '../staff/capabilities';
import {
  deliverStaffToStudent,
  listCuratorThreadsForCourse,
  loadCuratorThreadMessages,
  markCuratorThreadRead,
  staffStudentLabel,
} from '../staff/messaging';
import {
  renderCuratorMessagesInbox,
  renderCuratorMessageThread,
  renderCuratorUnreadThreadsInbox,
} from '../staff/curator-messages-screens';
import {
  collectCuratorHomeworkQueue,
  renderCuratorHomeworkHub,
  renderCuratorHomeworkList,
  type CuratorHomeworkQueueKind,
} from '../staff/curator-homework-screens';
import { loadCuratorActivitySnapshot } from '../staff/curator-activity-data';
import {
  pendingHomeworkFromStudents,
  renderCuratorActivityHome,
  renderCuratorActivityReviewList,
  renderCuratorAttentionList,
  renderCuratorCourseStudentsBotList,
  renderCuratorLowLivesList,
} from '../staff/curator-activity-screens';
import { formatTelegramFileRef } from '../studentHomeworkFlow';
import { enrichCuratorStudentCard } from '../staff/curator-student-enrich';
import {
  approveCourseHomeworkByCurator,
  deductLifeForHomeworkDebtByCurator,
  formatLifeDeductionNote,
  rejectCourseHomeworkByCurator,
  CourseHomeworkError,
} from '../education/course-homework';
import {
  adjustLives,
  getEnrollmentLives,
  grantBonusLife,
  initEnrollmentLives,
  isLivesTableError,
} from '../education/lives';
import { resolveCourseIdForContent } from '../education/course-record';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';
import {
  notifyStudentHomeworkReviewed,
  sendSubmissionToCurator,
} from '../studentHomeworkFlow';
import { COMBINED_HOME_TEXT } from '../staff/staff-combined-flow';
import {
  COMBINED_CURATOR_COURSE_NAV,
  COMBINED_CURATOR_HW_NAV,
  COMBINED_CURATOR_MSG_NAV,
  COMBINED_STUDENTS_NAV,
  type StaffScreenNav,
} from '../staff/staff-screen-nav';
import { loadCuratorCourseStudents } from '@/lib/curator/students';
import {
  CURATOR_BOT_MENU_LABELS,
  isStaffMenuLabel,
  resolveStaffBotMode,
  staffReplyKeyboard,
} from '../staff/staff-menu';
import { clearConflictingStaffStates } from '../staff/staff-reply-state';
import {
  CURATOR_REJECT_PHOTO_STEP,
  CURATOR_REJECT_TEXT_STEP,
  CURATOR_REJECT_VOICE_STEP,
  STAFF_CURATOR_REPLY_STEP,
} from '../staff/staff-steps';
import { buildCuratorBotWelcome } from '../staff/curator-home';
import {
  handleCuratorBotCallback,
  handleCuratorBotReplyMenu,
  verifySchedulePayloadCourse,
  type CuratorSchedulePayloadExt,
} from '../staff/curator-bot-handlers';
import { CURATOR_BOT_WELCOME_TEXT } from '../staff/curator-bot-screens';
import {
  applyCuratorLessonSchedule,
  CURATOR_SCHEDULE_DATETIME_STEP,
  listCuratorLessonsForSchedule,
  loadCuratorLessonForSchedule,
  parseCuratorScheduleInput,
  renderCuratorScheduleLessonList,
  renderCuratorSchedulePrompt,
  type CuratorSchedulePayload,
} from '../staff/curator-schedule-bot';
import { formatLessonDateTimeRu } from '@/lib/teacher/format';

async function curatorHomeworkCourseOptions(
  admin: SupabaseClient,
  curatorTelegramId: number,
): Promise<{ courseId: number; courseSlug: string } | null> {
  const { resolveCuratorCourseContext } = await import('@/lib/curator/course-context');
  const ctx = await resolveCuratorCourseContext(admin, curatorTelegramId);
  if (!ctx) return null;
  return { courseId: ctx.courseId, courseSlug: ctx.slug };
}

// ---------------------------------------------------------------------------
// Кабинет куратора курса (role = curator). Данные — Supabase + Sanity.
//
// Архитектура та же, что у админки и кабинета преподавателя:
// • Reply Keyboard — постоянное главное меню под полем ввода;
// • Inline Keyboard — экраны разделов, навигация через editMessageText;
// • новое сообщение — результаты действий (одобрение/отклонение ДЗ,
//   ответ на текст/голос/фото), чтобы результат был под сообщением ментора.
//
// ---------------------------------------------------------------------------

export { STAFF_CURATOR_REPLY_STEP } from '../staff/staff-steps';

type CuratorReplyPayload = AdminPayload & { studentTelegramId?: number; courseId?: number };

export const CURATOR_MENU_LABELS = CURATOR_BOT_MENU_LABELS;

export const CURATOR_MENU_LABEL_SET = new Set<string>(Object.values(CURATOR_MENU_LABELS));

const CURATOR_HOME_FALLBACK = CURATOR_BOT_WELCOME_TEXT;

async function curatorCabinetScreen(
  admin: SupabaseClient,
  telegramId: number,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const { resolveCuratorWebCabinetPath } = await import('@/lib/staff/staff-cabinet-access');
  const { getStaffCourseWorkspace } = await import('../staff/staff-course-session');
  const ws = await getStaffCourseWorkspace(admin, telegramId);
  const path = await resolveCuratorWebCabinetPath(admin, telegramId, ws?.courseId ?? null);
  const url = await createCabinetLoginUrl(admin, telegramId, path);
  return {
    text: '🌐 Кабинет куратора\n\nЗанятия, материалы и эфиры — на сайте:',
    keyboard: {
      inline_keyboard: [
        [{ text: '🌐 Открыть кабинет куратора', url }],
        [backButton('⬅️ Назад', 'c:menu')],
      ],
    },
  };
}

const CURATOR_UNKNOWN_TEXT =
  'Я не понял это сообщение.\n\nРазделы кабинета — на кнопках меню под полем ввода.';

const STEP_REJECT_TEXT = CURATOR_REJECT_TEXT_STEP;
const STEP_REJECT_VOICE = CURATOR_REJECT_VOICE_STEP;
const STEP_REJECT_PHOTO = CURATOR_REJECT_PHOTO_STEP;

type RejectPayload = AdminPayload & { studentId?: string; hwNumber?: number };

// ---------------------------------------------------------------------------
// Главное меню (Reply Keyboard)
// ---------------------------------------------------------------------------

/** @deprecated используй staffReplyKeyboard через sendCuratorStart */
export function curatorReplyKeyboard(): ReplyKeyboard {
  return {
    keyboard: [
      [{ text: CURATOR_MENU_LABELS.schedule }],
      [{ text: CURATOR_MENU_LABELS.lessons }],
      [{ text: CURATOR_MENU_LABELS.students }],
      [{ text: CURATOR_MENU_LABELS.cabinet }],
    ],
    resize_keyboard: true,
  };
}

async function canUseCuratorBot(admin: SupabaseClient, telegramId: number): Promise<boolean> {
  const caps = await loadStaffCapabilities(admin, telegramId);
  return caps.canCuratorBot;
}

async function curatorCabinetUrl(admin: SupabaseClient, telegramId: number): Promise<string | null> {
  try {
    const { resolveCuratorWebCabinetPath } = await import('@/lib/staff/staff-cabinet-access');
    const { getStaffCourseWorkspace } = await import('../staff/staff-course-session');
    const ws = await getStaffCourseWorkspace(admin, telegramId);
    const path = await resolveCuratorWebCabinetPath(admin, telegramId, ws?.courseId ?? null);
    return await createCabinetLoginUrl(admin, telegramId, path);
  } catch {
    return null;
  }
}

async function beginCuratorReply(
  admin: SupabaseClient,
  curatorTelegramId: number,
  chatId: number,
  studentTelegramId: number,
): Promise<void> {
  const scope = await resolveCuratorBotCourseScope(admin, curatorTelegramId);
  if (scope) {
    const { isStudentOnCourse } = await import('../education/student-course-context');
    const onCourse = await isStudentOnCourse(admin, studentTelegramId, scope.courseId);
    if (!onCourse) {
      await sendAdminMessage(chatId, 'Ученик не на выбранном курсе.');
      return;
    }
  }
  await clearConflictingStaffStates(admin, curatorTelegramId, 'curator_reply');
  try {
    await saveState(
      admin,
      curatorTelegramId,
      { chatId, messageId: 0 },
      STAFF_CURATOR_REPLY_STEP as never,
      { studentTelegramId, courseId: scope?.courseId } as never,
    );
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    await sendAdminMessage(chatId, migrationText('bot_conversation_states.sql'));
    return;
  }
  const label = await staffStudentLabel(admin, studentTelegramId);
  await sendAdminMessage(
    chatId,
    `✏️ Сообщение для ${label}\n\nВведите текст или отправьте фото/документ.\n\nОтмена — «Отмена».`,
    { inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: `c:msg:d:${studentTelegramId}` }]] },
  );
}

// /start для роли curator: приветствие + постоянное меню.
export async function sendCuratorStart(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
  testFooter = '',
): Promise<void> {
  const { clearStateIfAvailable } = await import('../admin/core');
  await clearStateIfAvailable(admin, telegramId);
  const caps = await loadStaffCapabilities(admin, telegramId);
  const { staffGlobalReplyKeyboard } = await import('../staff/staff-menu');
  const { STAFF_COURSE_HOME_TEXT } = await import('../staff/staff-course-hub-flow');
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: STAFF_COURSE_HOME_TEXT + testFooter,
    reply_markup: staffGlobalReplyKeyboard(caps),
  });
}

// ---------------------------------------------------------------------------
// Построители экранов (чистые функции — используются и в тестах).
// ---------------------------------------------------------------------------

function backButton(text: string, callback: string): InlineButton {
  return { text, callback_data: callback };
}

function notFoundKeyboard(backText: string, backCallback: string): InlineKeyboard {
  return { inline_keyboard: [[backButton(`⬅️ ${backText}`, backCallback)]] };
}

// --- Ученики (§5, §6) -------------------------------------------------------

export function renderCuratorStudentsList(
  students: CuratorStudentRecord[],
  nav?: StaffScreenNav,
): { text: string; keyboard: InlineKeyboard } {
  const back = nav?.listBack ?? 'c:stud';
  if (students.length === 0) {
    return {
      text:
        '👤 Ученики курса\n\n' +
        'Пока никого с активным доступом. Проверьте course_enrollments и user_accesses (product=course).',
      keyboard: { inline_keyboard: [[backButton('⬅️ Назад', back)]] },
    };
  }
  const text = `👤 Ученики курса\n\n${students.map((s) => listCuratorStudentLabel(s)).join('\n')}`;
  return {
    text,
    keyboard: {
      inline_keyboard: [
        ...students.map((s): InlineButton[] => [
          { text: listCuratorStudentLabel(s), callback_data: `c:sp:${s.id}` },
        ]),
        [backButton('⬅️ Назад', back)],
      ],
    },
  };
}

export type CuratorStudentProfileExtra = {
  livesCurrent: number | null;
  livesMax: number | null;
  accessBlocked: boolean;
  fullyBlocked: boolean;
  progressPercent?: number;
  completedLessons?: number;
  totalLessons?: number;
  lastActivityAt?: string | null;
  overdueHomeworkCount?: number;
  phone?: string | null;
};

export function renderCuratorStudentProfile(
  student: CuratorStudentRecord,
  livesOrExtra: number | null | CuratorStudentProfileExtra,
): { text: string; keyboard: InlineKeyboard } {
  const extra: CuratorStudentProfileExtra =
    typeof livesOrExtra === 'object' && livesOrExtra !== null
      ? livesOrExtra
      : {
          livesCurrent: livesOrExtra,
          livesMax: null,
          accessBlocked: false,
          fullyBlocked: false,
        };

  const summary = summarizeCuratorStudent(student);
  const enrich = enrichCuratorStudentCard(student);
  const livesLabel =
    extra.livesCurrent == null
      ? '—'
      : `${extra.livesCurrent}${extra.livesMax != null ? `/${extra.livesMax}` : ''}`;
  const activityLabel = extra.lastActivityAt
    ? new Date(extra.lastActivityAt).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'нет данных';

  const parts = [
    `👨‍🎓 ${student.name}`,
    '',
    `❤️ Жизни: ${livesLabel}`,
    extra.fullyBlocked
      ? '🔒 Полная блокировка: да'
      : extra.accessBlocked
        ? '⏸️ Заморозка: да'
        : '⏸️ Заморозка: нет',
    enrich.progressLine,
  ];
  if (extra.totalLessons != null && extra.completedLessons != null) {
    parts.push(
      `📚 Уроки курса: ${extra.completedLessons}/${extra.totalLessons} (${extra.progressPercent ?? 0}%)`,
    );
  }
  parts.push(`🕐 Последняя активность: ${activityLabel}`);
  if ((extra.overdueHomeworkCount ?? 0) > 0) {
    parts.push(`⏱ Просроченных ДЗ: ${extra.overdueHomeworkCount}`);
  }
  if (extra.phone?.trim()) parts.push(`☎️ ${extra.phone.trim()}`);
  parts.push('');

  if (enrich.activeHomeworkLine) {
    parts.push(enrich.activeHomeworkLine, '');
  }
  if (summary.debtCount > 0) {
    parts.push(
      `🔴 Задолженность: ${summary.debtCount} ДЗ`,
      '',
      'Не сданы:',
      ...summary.debtNumbers.map((n) => `• ДЗ №${n}`),
      '',
    );
  } else {
    parts.push('🟢 Задолженностей нет', '');
  }
  parts.push('📝 Домашние задания:');

  const hwButtons = student.homeworks.map(
    (hw): InlineButton[] => [
      {
        text: `${CURATOR_HW_STATUS_LABELS[hw.status].split(' ')[0]} ДЗ №${hw.number} — ${CURATOR_HW_STATUS_SHORT[hw.status]}`,
        callback_data: `c:shw:${student.id}:${hw.number}`,
      },
    ],
  );
  const text = parts.join('\n');
  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          { text: '+1 жизнь', callback_data: `c:life:g:${student.telegramId}` },
          { text: '−1 жизнь', callback_data: `c:life:d:${student.telegramId}` },
        ],
        [{ text: '💬 Написать в боте', callback_data: `c:msg:w:${student.telegramId}` }],
        [{ text: '📲 Открыть в Telegram', url: `tg://user?id=${student.telegramId}` }],
        ...hwButtons.slice(0, 12),
        [backButton('⬅️ Назад', 'c:stud')],
      ],
    },
  };
}

// --- Проверка ДЗ ученика (§8–§13) -------------------------------------------

export function renderCuratorHomeworkCard(
  student: CuratorStudentRecord,
  homework: CuratorHomeworkRecord,
): { text: string; keyboard: InlineKeyboard } {
  const text =
    '📝 ДОМАШНЕЕ ЗАДАНИЕ\n\n' +
    `Ученик: ${student.name}\n` +
    `Задание: ДЗ №${homework.number} — ${homework.title}\n` +
    `Статус: ${CURATOR_HW_STATUS_LABELS[homework.status]}\n\n` +
    (homework.submissionNote ? `Комментарий ученика:\n${homework.submissionNote}\n\n` : '') +
    '📎 Работа ученика';
  return {
    text,
    keyboard: {
      inline_keyboard: [
        ...(homework.status === 'waiting'
          ? [[{ text: '❤️ Снять жизнь (не сдано)', callback_data: `c:lded:${student.id}:${homework.number}` }]]
          : []),
        [{ text: '👀 Посмотреть', callback_data: `c:vieww:${student.id}:${homework.number}` }],
        [{ text: '✅ ОДОБРИТЬ', callback_data: `c:appr:${student.id}:${homework.number}` }],
        [{ text: '❌ ОТКЛОНИТЬ', callback_data: `c:rej:${student.id}:${homework.number}` }],
        [backButton('⬅️ Назад', `c:sp:${student.id}`)],
      ],
    },
  };
}

export function renderCuratorRejectMethod(studentId: string, hwNumber: number): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: '❌ Отклонение домашнего задания\n\nВыберите способ отправки комментария:',
    keyboard: {
      inline_keyboard: [
        [{ text: '✏️ Текст', callback_data: `c:rejt:${studentId}:${hwNumber}` }],
        [{ text: '🎤 Голосовое', callback_data: `c:rejv:${studentId}:${hwNumber}` }],
        [{ text: '📷 Фото', callback_data: `c:rejp:${studentId}:${hwNumber}` }],
        [{ text: '⏭ Без комментария', callback_data: `c:rejskip:${studentId}:${hwNumber}` }],
        [backButton('⬅️ Отмена', `c:rejc:${studentId}:${hwNumber}`)],
      ],
    },
  };
}

// --- Уведомления (§14, §15) --------------------------------------------------

export async function renderCuratorNotifications(
  admin: SupabaseClient,
  curatorTelegramId: number,
  students: CuratorStudentRecord[],
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const notifications = listCuratorSubmissionNotifications(students);
  const readFlags = await Promise.all(
    notifications.map((n) => isCuratorNotificationRead(admin, curatorTelegramId, n.id)),
  );
  const unread = notifications.filter((_, i) => !readFlags[i]);

  const parts = ['🔔 УВЕДОМЛЕНИЯ', ''];
  if (unread.length > 0) {
    parts.push(`🔴 Новые домашние задания — ${unread.length}`);
    for (const n of unread) {
      parts.push('', n.studentName, `📎 Отправил${feminineEnding(n.studentName)} ДЗ №${n.hwNumber}`);
    }
  } else {
    parts.push('Новых домашних заданий нет.');
  }

  const buttons = notifications.map(
    (n, i): InlineButton[] => [
      {
        text: `${readFlags[i] ? '✓' : '📎'} ${n.studentName} — ДЗ №${n.hwNumber}`,
        callback_data: `c:notv:${n.id}`,
      },
    ],
  );
  return {
    text: parts.join('\n'),
    keyboard: {
      inline_keyboard: [
        ...buttons,
        [{ text: '🔔 Контроль перед занятием', callback_data: 'c:pre' }],
        [backButton('⬅️ Назад', 'c:menu')],
      ],
    },
  };
}

export async function renderCuratorNotificationView(
  admin: SupabaseClient,
  curatorTelegramId: number,
  students: CuratorStudentRecord[],
  notificationId: string,
): Promise<{ text: string; keyboard: InlineKeyboard } | null> {
  const notification = getCuratorNotificationById(students, notificationId);
  if (!notification) return null;
  await markCuratorNotificationRead(admin, curatorTelegramId, notificationId);
  const text =
    `📎 ${notification.studentName} отправил${feminineEnding(notification.studentName)} ДЗ №${notification.hwNumber}\n\n` +
    'Статус:\n' +
    '🟡 Ожидает проверки';
  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          {
            text: '👀 Открыть ДЗ',
            callback_data: `c:shw:${notification.studentId}:${notification.hwNumber}`,
          },
        ],
        [backButton('⬅️ Назад', 'c:notif')],
      ],
    },
  };
}

// «Отправил/Отправила» по имени: упрощённо по конечной гласной.
function feminineEnding(name: string): string {
  const first = name.split(' ')[0] ?? '';
  return first.endsWith('а') || first.endsWith('я') ? 'а' : '';
}

// --- Контроль перед занятием (§16) -------------------------------------------

export function renderCuratorPreLesson(students: CuratorStudentRecord[]): { text: string; keyboard: InlineKeyboard } {
  const summary = summarizeCuratorStudents(students);
  const text =
    '🔔 КОНТРОЛЬ ПЕРЕД ЗАНЯТИЕМ\n\n' +
    'Завтра занятие.\n\n' +
    'По предыдущим заданиям:\n\n' +
    `🔴 Не сдали ДЗ: ${summary.notSubmitted} учеников\n` +
    `🟡 ДЗ ожидают проверки: ${summary.awaitingReview}\n` +
    `🔄 На доработке: ${summary.revision}\n\n` +
    'Рекомендуем проверить работы до начала занятия.';
  return {
    text,
    keyboard: {
      inline_keyboard: [
        [{ text: '👨‍🎓 Посмотреть должников', callback_data: 'c:stud' }],
        [{ text: '📝 Проверить ДЗ', callback_data: 'c:notif' }],
        [backButton('⬅️ Назад', 'c:notif')],
      ],
    },
  };
}

export async function renderCuratorCabinet(
  admin: SupabaseClient,
  telegramId: number,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  return curatorCabinetScreen(admin, telegramId);
}

async function editCuratorScreen(message: AdminMessage, text: string, keyboard: InlineKeyboard): Promise<void> {
  await editAdminMessage(message, text, keyboard);
}

// ---------------------------------------------------------------------------
// Текст Reply Keyboard: разделы меню + текстовый комментарий при отклонении.
// ---------------------------------------------------------------------------

export async function handleCuratorMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  if (!(await canUseCuratorBot(admin, telegramId))) return false;
  const caps = await loadStaffCapabilities(admin, telegramId);
  const staffMode = resolveStaffBotMode(caps);

  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  const step = state?.step as string | undefined;

  if (state && step === STAFF_CURATOR_REPLY_STEP) {
    const payload = state.payload as CuratorReplyPayload;
    const studentId = payload.studentTelegramId;
    if (!studentId) return false;
    if (isStaffMenuLabel(text, caps)) {
      await clearStateIfAvailable(admin, telegramId);
      return false;
    }
    if (/^отмена$/i.test(text.trim())) {
      await clearStateIfAvailable(admin, telegramId);
      await sendAdminMessage(chatId, 'Отправка отменена.');
      return true;
    }
    try {
      const courseId = payload.courseId ?? (await resolveCuratorBotCourseScope(admin, telegramId))?.courseId;
      await deliverStaffToStudent(admin, {
        staffTelegramId: telegramId,
        staffRole: 'curator',
        studentTelegramId: studentId,
        body: text.trim(),
        courseId: courseId ?? null,
      });
      await clearStateIfAvailable(admin, telegramId);
      await sendAdminMessage(chatId, '✅ Сообщение отправлено ученику.');
    } catch (error) {
      await sendAdminMessage(chatId, error instanceof Error ? error.message : 'Не удалось отправить.');
    }
    return true;
  }

  if (state && step === (await import('@/lib/bot/staff/staff-steps')).CURATOR_STU_SEARCH_STEP) {
    const payload = state.payload as { courseId?: number };
    const courseId = payload.courseId;
    if (isStaffMenuLabel(text, caps)) {
      await clearStateIfAvailable(admin, telegramId);
      return false;
    }
    if (/^отмена$/i.test(text.trim()) || !courseId) {
      await clearStateIfAvailable(admin, telegramId);
      const { sendCuratorSectionForCourse } = await import('@/lib/bot/staff/curator-bot-handlers');
      await sendCuratorSectionForCourse(admin, chatId, telegramId, 'stu', courseId!);
      return true;
    }
    const { setCuratorStudentSearchQuery } = await import('@/lib/bot/staff/curator-bot-handlers');
    setCuratorStudentSearchQuery(courseId, telegramId, text.trim());
    await clearStateIfAvailable(admin, telegramId);
    const { loadCuratorBotCabinet, assertCuratorCourseAccess } = await import(
      '@/lib/bot/staff/curator-bot-access'
    );
    const ctx = await assertCuratorCourseAccess(admin, telegramId, courseId);
    const loaded = await loadCuratorBotCabinet(admin, telegramId, courseId);
    if (!loaded || !ctx) return true;
    const { loadCuratorCourseStudents } = await import('@/lib/curator/students');
    const { renderCuratorStudentsList } = await import('@/lib/bot/staff/curator-bot-screens');
    const { students } = await loadCuratorCourseStudents(admin, telegramId, {
      courseId,
      courseSlug: ctx.slug,
    });
    const q = text.trim().toLowerCase();
    const filtered = students.filter((s) => s.name.toLowerCase().includes(q));
    const screen = renderCuratorStudentsList(courseId, loaded.data.courseTitle, filtered);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }

  // Дата следующего / выбранного занятия → Sanity.
  if (state && step === CURATOR_SCHEDULE_DATETIME_STEP) {
    const payload = state.payload as CuratorSchedulePayloadExt;
    const sanityLessonId = payload.sanityLessonId;
    if (!sanityLessonId) return false;
    if (!(await verifySchedulePayloadCourse(admin, telegramId, payload))) {
      await clearStateIfAvailable(admin, telegramId);
      await sendAdminMessage(chatId, 'Нет доступа к занятию или курс изменился.');
      return true;
    }
    if (isStaffMenuLabel(text, caps)) {
      await clearStateIfAvailable(admin, telegramId);
      return false;
    }
    if (/^отмена$/i.test(text.trim())) {
      await clearStateIfAvailable(admin, telegramId);
      const courseId = payload.courseId;
      if (courseId != null) {
        const { sendCuratorSectionForCourse } = await import('@/lib/bot/staff/curator-bot-handlers');
        await sendCuratorSectionForCourse(admin, chatId, telegramId, 'cal', courseId);
      }
      return true;
    }
    const parsed = parseCuratorScheduleInput(text);
    if (!parsed) {
      await sendAdminMessage(
        chatId,
        'Не понял дату. Формат: ДД.ММ.ГГГГ ЧЧ:ММ (МСК)\nПример: 15.10.2026 18:00',
      );
      return true;
    }
    const when = formatLessonDateTimeRu(parsed.scheduledAtIso);
    try {
      const { CURATOR_SCHEDULE_CONFIRM_STEP } = await import('@/lib/bot/staff/staff-steps');
      await saveState(
        admin,
        telegramId,
        { chatId, messageId: 0 },
        CURATOR_SCHEDULE_CONFIRM_STEP as never,
        {
          ...payload,
          pendingScheduledAtIso: parsed.scheduledAtIso,
          pendingLessonDate: parsed.lessonDate,
        } as never,
      );
    } catch (error) {
      if (!isConversationStateTableError(error)) throw error;
    }
    const courseId = payload.courseId;
    const lessonNum = payload.lessonNumber;
    await sendAdminMessage(
      chatId,
      [
        '📅 Подтвердите дату занятия',
        '',
        payload.lessonTitle ?? 'Урок',
        when,
      ].join('\n'),
      {
        inline_keyboard: [
          [
            {
              text: '✅ Назначить',
              callback_data:
                courseId != null && lessonNum != null
                  ? `c:sd:ok:${courseId}:${lessonNum}`
                  : 'noop',
            },
          ],
          [
            {
              text: '⬅️ Отмена',
              callback_data:
                courseId != null ? `c:cal:${courseId}` : 'c:hub',
            },
          ],
        ],
      },
    );
    return true;
  }

  // Комментарий при отклонении ДЗ текстом (§11).
  if (state && step === STEP_REJECT_TEXT) {
    await clearStateIfAvailable(admin, telegramId);
    const payload = state.payload as RejectPayload;
    const studentId = payload.studentId ?? '';
    const hwNumber = payload.hwNumber ?? 0;
    const students = await loadCuratorStudentsForBot(admin, telegramId);
    const student = getCuratorStudentRecord(students, studentId);
    if (!student) {
      await sendAdminMessage(chatId, 'Не удалось найти работу.');
      return true;
    }
    try {
      const courseOpts = await curatorHomeworkCourseOptions(admin, telegramId);
      const { lesson, lifeDeduction } = await rejectCourseHomeworkByCurator(
        admin,
        telegramId,
        student.telegramId,
        hwNumber,
        text,
        {
          courseId: courseOpts?.courseId ?? null,
          courseSlug: courseOpts?.courseSlug ?? null,
        },
      );
      await notifyStudentHomeworkReviewed(admin, student.telegramId, {
        lessonNumber: lesson.lessonNumber,
        title: lesson.title,
        approved: false,
        note: text,
      });
      await sendAdminMessage(
        chatId,
        '❌ ДЗ отклонено.\n\n' +
          `Ученик: ${student.name}\n\n` +
          `Комментарий:\n«${text}»` +
          formatLifeDeductionNote(lifeDeduction),
        { inline_keyboard: [[backButton('⬅️ Назад', `c:sp:${studentId}`)]] },
      );
    } catch (error) {
      const message = error instanceof CourseHomeworkError ? error.message : 'Не удалось отклонить домашку.';
      await sendAdminMessage(chatId, message);
    }
    return true;
  }

  if (staffMode === 'combined') return false;

  const { getStaffCourseWorkspace } = await import('../staff/staff-course-session');
  const ws = await getStaffCourseWorkspace(admin, telegramId);
  if (ws?.role === 'curator') return false;
  if (ws?.role === 'check') return false;

  const { CHECK_BOT_MENU_LABEL_SET } = await import('../staff/staff-menu');
  if (CHECK_BOT_MENU_LABEL_SET.has(text)) return false;

  const menuHandled = await handleCuratorBotReplyMenu(admin, telegramId, chatId, text, 'curator_only');
  if (menuHandled) return true;

  if (!CURATOR_MENU_LABEL_SET.has(text)) {
    if (
      state &&
      (step === STAFF_CURATOR_REPLY_STEP ||
        step === STEP_REJECT_TEXT ||
        step === CURATOR_SCHEDULE_DATETIME_STEP)
    ) {
      return false;
    }
    await sendAdminMessage(chatId, CURATOR_UNKNOWN_TEXT);
    return true;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Вложения: голосовое или фото как комментарий при отклонении → ученику.
// ---------------------------------------------------------------------------

export async function handleCuratorAttachment(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  kind: 'voice' | 'photo' | 'document',
  fileId: string,
): Promise<boolean> {
  if (!(await canUseCuratorBot(admin, telegramId))) return false;

  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }
  const step = state?.step as string | undefined;

  if (state && step === STAFF_CURATOR_REPLY_STEP && (kind === 'photo' || kind === 'document')) {
    const payload = state.payload as CuratorReplyPayload;
    const studentId = payload.studentTelegramId;
    if (!studentId) return false;
    try {
      const courseId = payload.courseId ?? (await resolveCuratorBotCourseScope(admin, telegramId))?.courseId;
      await deliverStaffToStudent(admin, {
        staffTelegramId: telegramId,
        staffRole: 'curator',
        studentTelegramId: studentId,
        body: '',
        attachmentRef: formatTelegramFileRef(fileId),
        attachmentKind: kind,
        courseId: courseId ?? null,
      });
      await clearStateIfAvailable(admin, telegramId);
      await sendAdminMessage(chatId, '✅ Вложение отправлено ученику.');
    } catch (error) {
      await sendAdminMessage(chatId, error instanceof Error ? error.message : 'Не удалось отправить.');
    }
    return true;
  }

  const expected =
    kind === 'voice'
      ? STEP_REJECT_VOICE
      : kind === 'photo' || kind === 'document'
        ? STEP_REJECT_PHOTO
        : null;
  if (!expected || !state || step !== expected) {
    if (kind === 'document') return false;
    return false;
  }

  await clearStateIfAvailable(admin, telegramId);
  const payload = state.payload as RejectPayload;
  const studentId = payload.studentId ?? '';
  const hwNumber = payload.hwNumber ?? 0;
  const students = await loadCuratorStudentsForBot(admin, telegramId);
  const student = getCuratorStudentRecord(students, studentId);
  if (!student) {
    await sendAdminMessage(chatId, 'Не удалось найти работу.');
    return true;
  }
  try {
    const courseOpts = await curatorHomeworkCourseOptions(admin, telegramId);
    const { lesson, lifeDeduction } = await rejectCourseHomeworkByCurator(
      admin,
      telegramId,
      student.telegramId,
      hwNumber,
      undefined,
      {
        courseId: courseOpts?.courseId ?? null,
        courseSlug: courseOpts?.courseSlug ?? null,
      },
    );
    const mediaNote =
      kind === 'voice'
        ? 'Голосовой комментарий от куратора — см. сообщение ниже.'
        : kind === 'document'
          ? 'Файл с правками от куратора — см. вложение ниже.'
          : 'Комментарий на фото от куратора — см. сообщение ниже.';
    await notifyStudentHomeworkReviewed(admin, student.telegramId, {
      lessonNumber: lesson.lessonNumber,
      title: lesson.title,
      approved: false,
      note: mediaNote,
      reviewFileRef: formatTelegramFileRef(fileId),
      reviewFileKind: kind === 'voice' ? 'voice' : kind === 'photo' ? 'photo' : 'document',
    });

    await sendAdminMessage(
      chatId,
      `❌ ДЗ отклонено.\n\nУченик: ${student.name}\nДЗ: №${hwNumber}\n\nКомментарий отправлен ученику.` +
        formatLifeDeductionNote(lifeDeduction),
      { inline_keyboard: [[backButton('⬅️ Назад', `c:sp:${studentId}`)]] },
    );
  } catch (error) {
    const message = error instanceof CourseHomeworkError ? error.message : 'Не удалось отклонить домашку.';
    await sendAdminMessage(chatId, message);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Inline-навигация: колбэки c:*. Возвращает false для чужих префиксов
// и для не-менторов.
// ---------------------------------------------------------------------------

function isCourseStaffMyCourseCallback(data: string): boolean {
  return data === 'c:mc' || data === 'c:hub' || data.startsWith('c:mc:') || data === 'noop';
}

export async function handleCuratorCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!data.startsWith('c:')) return false;

  const caps = await loadStaffCapabilities(admin, telegramId);
  const curatorBot = caps.canCuratorBot;
  const courseStaffOnly =
    !curatorBot && caps.canCourseStaffBot && isCourseStaffMyCourseCallback(data);

  if (!curatorBot && !courseStaffOnly) return false;

  const message: AdminMessage = { chatId, messageId };
  if (courseStaffOnly) {
    const handled = await handleCuratorBotCallback(admin, message, telegramId, data);
    if (!handled) return false;
    if (callbackQueryId) {
      await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
    }
    return true;
  }

  const handled = await routeCuratorCallback(admin, message, telegramId, data.split(':'), data);
  if (!handled) return false;

  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }
  return true;
}

async function routeCuratorCallback(
  admin: SupabaseClient,
  message: AdminMessage,
  telegramId: number,
  parts: string[],
  fullData: string,
): Promise<boolean> {
  const botHandled = await handleCuratorBotCallback(admin, message, telegramId, fullData);
  if (botHandled) return true;

  const [, action, id, subId] = parts;
  const restId = parts.slice(3).join(':');
  const hwNumber = Number(subId);
  const cabinetUrl = await curatorCabinetUrl(admin, telegramId);
  const caps = await loadStaffCapabilities(admin, telegramId);
  const combined = resolveStaffBotMode(caps) === 'combined';
  const legacyLibrary =
    action === 'lib' || action === 'libw' || action === 'libv' || action === 'libf';

  if (!combined || legacyLibrary) {
    if (action !== 'noop') {
      await editCuratorScreen(message, 'Эта кнопка устарела. Используйте меню под полем ввода.', {
        inline_keyboard: [[{ text: '🏠 Главная', callback_data: 'c:hub' }]],
      });
    }
    return true;
  }
  const hwNav: StaffScreenNav | undefined = combined ? COMBINED_CURATOR_HW_NAV : undefined;
  const msgNav: StaffScreenNav | undefined = combined ? COMBINED_CURATOR_MSG_NAV : undefined;
  const courseNav: StaffScreenNav | undefined = combined ? COMBINED_CURATOR_COURSE_NAV : undefined;

  switch (action) {
    case 'menu':
    case 'home': {
      if (combined) {
        await editCuratorScreen(message, COMBINED_HOME_TEXT, { inline_keyboard: [] });
        return true;
      }
      const home = buildCuratorBotWelcome();
      await editCuratorScreen(message, home.text, home.keyboard);
      return true;
    }

    case 'sch': {
      if (id === 'list') {
        const lessons = await listCuratorLessonsForSchedule(admin, telegramId);
        const screen = renderCuratorScheduleLessonList(
          lessons,
          combined ? { mainMenuBack: 's:sch:c' } : undefined,
        );
        await editCuratorScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (id === 'pick' && restId) {
        const lesson = await loadCuratorLessonForSchedule(admin, telegramId, restId);
        if (!lesson) {
          await editCuratorScreen(message, 'Урок не найден.', notFoundKeyboard('Назад', 'c:sch:list'));
          return true;
        }
        try {
          await clearConflictingStaffStates(admin, telegramId, 'curator_schedule');
          await saveState(
            admin,
            telegramId,
            { chatId: message.chatId, messageId: message.messageId },
            CURATOR_SCHEDULE_DATETIME_STEP as never,
            { sanityLessonId: lesson.sanityId, lessonTitle: lesson.title } as never,
          );
        } catch (error) {
          if (!isConversationStateTableError(error)) throw error;
          await sendAdminMessage(message.chatId, migrationText('bot_conversation_states.sql'));
          return true;
        }
        const screen = renderCuratorSchedulePrompt(lesson);
        await editCuratorScreen(message, screen.text, screen.keyboard);
        return true;
      }
      return true;
    }

    case 'life': {
      const op = id; // g | d
      const studentTelegramId = Number(subId);
      if ((op !== 'g' && op !== 'd') || !Number.isFinite(studentTelegramId)) return true;
      try {
        const content = await getDistrictCourseContent();
        const courseId = content ? await resolveCourseIdForContent(admin, content) : null;
        if (!courseId) {
          await sendAdminMessage(message.chatId, 'Курс не найден — жизни недоступны.');
          return true;
        }
        await initEnrollmentLives(admin, studentTelegramId, courseId);
        if (op === 'g') {
          await grantBonusLife(admin, {
            telegramId: studentTelegramId,
            courseId,
            curatorTelegramId: telegramId,
            reason: 'Начисление куратором',
          });
          await sendAdminMessage(message.chatId, '✅ +1 жизнь начислена.');
        } else {
          await adjustLives(admin, {
            telegramId: studentTelegramId,
            courseId,
            delta: -1,
            reason: 'Списание куратором',
            actorTelegramId: telegramId,
            operationType: 'correction',
          });
          await sendAdminMessage(message.chatId, '✅ −1 жизнь списана.');
        }
        // Обновить карточку если возможно
        const students = await loadCuratorStudentsForBot(admin, telegramId);
        const student = getCuratorStudentRecord(students, String(studentTelegramId));
        if (student) {
          const { students: courseViews } = await loadCuratorCourseStudents(admin, telegramId);
          const view = courseViews.find((s) => s.telegramId === studentTelegramId);
          const lives = await getEnrollmentLives(admin, studentTelegramId, courseId);
          const screen = renderCuratorStudentProfile(student, {
            livesCurrent: lives?.lives_current ?? null,
            livesMax: lives?.lives_max ?? null,
            accessBlocked: Boolean(lives?.access_blocked),
            fullyBlocked: Boolean(lives?.fully_blocked),
            progressPercent: view?.progressPercent,
            completedLessons: view?.completedLessons,
            totalLessons: view?.totalLessons,
            lastActivityAt: view?.lastActivityAt ?? null,
            overdueHomeworkCount: view?.overdueHomeworkCount,
            phone: view?.phone ?? null,
          });
          await editCuratorScreen(message, screen.text, screen.keyboard);
        }
      } catch (error) {
        if (isLivesTableError(error)) {
          await sendAdminMessage(message.chatId, 'Таблицы жизней недоступны.');
          return true;
        }
        await sendAdminMessage(
          message.chatId,
          error instanceof Error ? error.message : 'Не удалось изменить жизни.',
        );
      }
      return true;
    }

    case 'hw': {
      if (id === 'q' && subId) {
        const queue = subId as CuratorHomeworkQueueKind;
        const students = await loadCuratorStudentsForBot(admin, telegramId);
        const items = collectCuratorHomeworkQueue(students, queue);
        const screen = renderCuratorHomeworkList(queue, items, cabinetUrl, hwNav);
        await editCuratorScreen(message, screen.text, screen.keyboard);
        return true;
      }
      const hub = renderCuratorHomeworkHub(cabinetUrl, hwNav);
      await editCuratorScreen(message, hub.text, hub.keyboard);
      return true;
    }

    case 'act': {
      const snapshot = await loadCuratorActivitySnapshot(admin, telegramId);
      if (id === 'students') {
        const { students } = await loadCuratorCourseStudents(admin, telegramId);
        const screen = renderCuratorCourseStudentsBotList(students, courseNav);
        await editCuratorScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (id === 'attn') {
        const screen = renderCuratorAttentionList(snapshot.attentionItems, courseNav);
        await editCuratorScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (id === 'lives') {
        const screen = renderCuratorLowLivesList(snapshot.lowLives, cabinetUrl);
        await editCuratorScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (id === 'review') {
        const students = await loadCuratorStudentsForBot(admin, telegramId);
        const screen = renderCuratorActivityReviewList(
          pendingHomeworkFromStudents(students),
          cabinetUrl,
          courseNav,
        );
        await editCuratorScreen(message, screen.text, screen.keyboard);
        return true;
      }
      const home = renderCuratorActivityHome(snapshot, cabinetUrl, courseNav);
      await editCuratorScreen(message, home.text, home.keyboard);
      return true;
    }

    case 'msg': {
      const msgCourse = await resolveCuratorBotCourseScope(admin, telegramId);
      const msgCourseId = msgCourse?.courseId ?? null;
      if (id === 'l') {
        const { threads, storageEnabled } = msgCourseId
          ? await listCuratorThreadsForCourse(admin, telegramId, msgCourseId)
          : { threads: [], storageEnabled: true };
        const screen = renderCuratorMessagesInbox(threads, storageEnabled, cabinetUrl, msgNav);
        await editCuratorScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (id === 'u') {
        const { threads, storageEnabled } = msgCourseId
          ? await listCuratorThreadsForCourse(admin, telegramId, msgCourseId)
          : { threads: [], storageEnabled: true };
        const screen = renderCuratorUnreadThreadsInbox(threads, storageEnabled, cabinetUrl, msgNav);
        await editCuratorScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (id === 'd' && subId) {
        const studentId = Number(subId);
        if (!Number.isFinite(studentId)) return true;
        await markCuratorThreadRead(admin, telegramId, studentId);
        const label = await staffStudentLabel(admin, studentId);
        const { messages, storageEnabled } = await loadCuratorThreadMessages(
          admin,
          telegramId,
          studentId,
          25,
          msgCourseId,
        );
        const screen = renderCuratorMessageThread(
          label,
          messages,
          storageEnabled,
          cabinetUrl,
          studentId,
          msgNav,
        );
        await editCuratorScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (id === 'w' && subId) {
        const studentId = Number(subId);
        if (!Number.isFinite(studentId)) return true;
        await beginCuratorReply(admin, telegramId, message.chatId, studentId);
        return true;
      }
      return true;
    }

    // Ученики: список → профиль → карточка ДЗ.
    case 'stud': {
      if (combined) {
        const { students } = await loadCuratorCourseStudents(admin, telegramId);
        const screen = renderCuratorCourseStudentsBotList(students, COMBINED_STUDENTS_NAV);
        await editCuratorScreen(message, screen.text, screen.keyboard);
        return true;
      }
      const students = await loadCuratorStudentsForBot(admin, telegramId);
      const screen = renderCuratorStudentsList(students);
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'sp': {
      const students = await loadCuratorStudentsForBot(admin, telegramId);
      let student = id ? getCuratorStudentRecord(students, id) : undefined;
      // id может быть telegramId строкой (ученики курса)
      if (!student && id && Number.isFinite(Number(id))) {
        student = students.find((s) => s.telegramId === Number(id));
      }
      if (!student) {
        const { students: courseViews } = await loadCuratorCourseStudents(admin, telegramId);
        const view = courseViews.find((s) => s.id === id || String(s.telegramId) === id);
        if (!view) {
          await editCuratorScreen(message, 'Ученик не найден.', notFoundKeyboard('Назад', 'c:stud'));
          return true;
        }
        student = view;
      }
      const { students: courseViews } = await loadCuratorCourseStudents(admin, telegramId);
      const view = courseViews.find((s) => s.telegramId === student!.telegramId);
      const content = await getDistrictCourseContent();
      const courseId = content ? await resolveCourseIdForContent(admin, content) : null;
      const lives = courseId
        ? await getEnrollmentLives(admin, student.telegramId, courseId)
        : null;
      const screen = renderCuratorStudentProfile(student, {
        livesCurrent: lives?.lives_current ?? view?.livesCurrent ?? null,
        livesMax: lives?.lives_max ?? view?.livesMax ?? null,
        accessBlocked: Boolean(lives?.access_blocked ?? view?.accessBlocked),
        fullyBlocked: Boolean(lives?.fully_blocked ?? view?.fullyBlocked),
        progressPercent: view?.progressPercent,
        completedLessons: view?.completedLessons,
        totalLessons: view?.totalLessons,
        lastActivityAt: view?.lastActivityAt ?? null,
        overdueHomeworkCount: view?.overdueHomeworkCount,
        phone: view?.phone ?? null,
      });
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'shw': {
      const students = await loadCuratorStudentsForBot(admin, telegramId);
      const student = id ? getCuratorStudentRecord(students, id) : undefined;
      const homework = student && subId ? getCuratorHomeworkRecord(student, hwNumber) : undefined;
      if (!student || !homework) {
        await editCuratorScreen(message, 'Работа не найдена.', notFoundKeyboard('Назад', 'c:stud'));
        return true;
      }
      const screen = renderCuratorHomeworkCard(student, homework);
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }

    case 'vieww': {
      const students = await loadCuratorStudentsForBot(admin, telegramId);
      const student = id ? getCuratorStudentRecord(students, id) : undefined;
      const homework = student && subId ? getCuratorHomeworkRecord(student, hwNumber) : undefined;
      if (!student || !homework) {
        await sendAdminMessage(message.chatId, 'Работа не найдена.');
        return true;
      }
      await sendSubmissionToCurator(admin, telegramId, {
        studentName: student.name,
        lessonNumber: homework.number,
        title: homework.title,
        fileUrl: homework.submissionFileUrl,
        note: homework.submissionNote,
      });
      await sendAdminMessage(message.chatId, '📎 Работа ученика отправлена выше.', {
        inline_keyboard: [[backButton('⬅️ Назад', `c:shw:${id}:${subId}`)]],
      });
      return true;
    }

    case 'appr': {
      const students = await loadCuratorStudentsForBot(admin, telegramId);
      const student = id ? getCuratorStudentRecord(students, id) : undefined;
      if (!student) {
        await editCuratorScreen(message, 'Работа не найдена.', notFoundKeyboard('Назад', 'c:stud'));
        return true;
      }
      try {
        const courseOpts = await curatorHomeworkCourseOptions(admin, telegramId);
        const { lesson } = await approveCourseHomeworkByCurator(
          admin,
          telegramId,
          student.telegramId,
          hwNumber,
          {
            courseId: courseOpts?.courseId ?? null,
            courseSlug: courseOpts?.courseSlug ?? null,
          },
        );
        await notifyStudentHomeworkReviewed(admin, student.telegramId, {
          lessonNumber: lesson.lessonNumber,
          title: lesson.title,
          approved: true,
        });
        await sendAdminMessage(
          message.chatId,
          `✅ Домашнее задание одобрено.\n\nУченик: ${student.name}\nДЗ: №${hwNumber}`,
          { inline_keyboard: [[backButton('⬅️ Назад', `c:sp:${id}`)]] },
        );
      } catch (error) {
        const msg = error instanceof CourseHomeworkError ? error.message : 'Не удалось одобрить домашку.';
        await sendAdminMessage(message.chatId, msg);
      }
      return true;
    }

    // Отклонение (§10): выбор способа комментария.
    case 'rej': {
      const screen = renderCuratorRejectMethod(id ?? '', hwNumber);
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'rejt':
    case 'rejv':
    case 'rejp': {
      const prompts: Record<string, { step: string; text: string }> = {
        rejt: {
          step: STEP_REJECT_TEXT,
          text: '✏️ Напишите комментарий ученику.\n\nОн увидит его в Telegram после отклонения ДЗ.\n\n⬅️ Отмена',
        },
        rejv: {
          step: STEP_REJECT_VOICE,
          text: '🎤 Отправьте голосовое сообщение.\n\nОно будет переслано ученику вместе с отклонением ДЗ.\n\n⬅️ Отмена',
        },
        rejp: {
          step: STEP_REJECT_PHOTO,
          text: '📷 Отправьте фото с комментарием.\n\nФото будет переслано ученику вместе с отклонением ДЗ.\n\n⬅️ Отмена',
        },
      };
      const prompt = prompts[action];
      const keyboard: InlineKeyboard = {
        inline_keyboard: [[backButton('⬅️ Отмена', `c:rejc:${id}:${subId}`)]],
      };
      try {
        const promptId = await sendAdminMessage(message.chatId, prompt.text, keyboard);
        await saveState(
          admin,
          telegramId,
          { chatId: message.chatId, messageId: promptId ?? 0 },
          prompt.step as never,
          { studentId: id, hwNumber } as never,
        );
      } catch (error) {
        if (!isConversationStateTableError(error)) throw error;
        await sendAdminMessage(message.chatId, migrationText('bot_conversation_states.sql'));
      }
      return true;
    }
    case 'rejskip': {
      const students = await loadCuratorStudentsForBot(admin, telegramId);
      const student = id ? getCuratorStudentRecord(students, id) : undefined;
      if (!student) {
        await editCuratorScreen(message, 'Работа не найдена.', notFoundKeyboard('Назад', 'c:stud'));
        return true;
      }
      try {
        const courseOpts = await curatorHomeworkCourseOptions(admin, telegramId);
        const { lesson, lifeDeduction } = await rejectCourseHomeworkByCurator(
          admin,
          telegramId,
          student.telegramId,
          hwNumber,
          undefined,
          {
            courseId: courseOpts?.courseId ?? null,
            courseSlug: courseOpts?.courseSlug ?? null,
          },
        );
        await notifyStudentHomeworkReviewed(admin, student.telegramId, {
          lessonNumber: lesson.lessonNumber,
          title: lesson.title,
          approved: false,
        });
        await sendAdminMessage(
          message.chatId,
          `❌ ДЗ отклонено.\n\nУченик: ${student.name}\nДЗ: №${hwNumber}\n\nКомментарий: без комментария.` +
            formatLifeDeductionNote(lifeDeduction),
          { inline_keyboard: [[backButton('⬅️ Назад', `c:sp:${id}`)]] },
        );
      } catch (error) {
        const msg = error instanceof CourseHomeworkError ? error.message : 'Не удалось отклонить домашку.';
        await sendAdminMessage(message.chatId, msg);
      }
      return true;
    }
    case 'lded': {
      const students = await loadCuratorStudentsForBot(admin, telegramId);
      const student = id ? getCuratorStudentRecord(students, id) : undefined;
      const homework = student && subId ? getCuratorHomeworkRecord(student, hwNumber) : undefined;
      if (!student || !homework) {
        await editCuratorScreen(message, 'Работа не найдена.', notFoundKeyboard('Назад', 'c:stud'));
        return true;
      }
      if (homework.status !== 'waiting' && homework.status !== 'revision') {
        await editCuratorScreen(
          message,
          'Снять жизнь можно за несданное или просроченное ДЗ (не на проверке/одобренное).',
          notFoundKeyboard('Назад', `c:shw:${id}:${hwNumber}`),
        );
        return true;
      }
      try {
        const { lifeDeduction } = await deductLifeForHomeworkDebtByCurator(
          admin,
          telegramId,
          student.telegramId,
          homework.sanityLessonId,
          'overdue',
        );
        const note = lifeDeduction?.deducted
          ? `❤️ Жизнь снята за ДЗ №${hwNumber}.`
          : lifeDeduction
            ? `Жизнь за это ДЗ уже была снята ранее.`
            : 'Не удалось обновить жизни.';
        if (lifeDeduction?.deducted) {
          const { notifyStudentLifeDeducted } = await import('@/lib/bot/student-push-notify');
          void notifyStudentLifeDeducted(admin, student.telegramId, {
            livesLeft: lifeDeduction.livesCurrent,
            livesMax: lifeDeduction.livesMax,
          });
        }
        const tail = lifeDeduction
          ? `\n\nОсталось: ${lifeDeduction.livesCurrent} из ${lifeDeduction.livesMax}.` +
            (lifeDeduction.accessBlocked
              ? '\n\n⚠️ Курс заморожен — новые занятия откроются после восстановления жизней.'
              : '')
          : '';
        await sendAdminMessage(message.chatId, `${note}${tail}`, {
          inline_keyboard: [[backButton('⬅️ Назад', `c:shw:${id}:${hwNumber}`)]],
        });
      } catch (error) {
        const msg =
          error instanceof CourseHomeworkError ? error.message : 'Не удалось снять жизнь.';
        await sendAdminMessage(message.chatId, msg, {
          inline_keyboard: [[backButton('⬅️ Назад', `c:shw:${id}:${hwNumber}`)]],
        });
      }
      return true;
    }

    case 'rejc': {
      await clearStateIfAvailable(admin, telegramId);
      const students = await loadCuratorStudentsForBot(admin, telegramId);
      const student = id ? getCuratorStudentRecord(students, id) : undefined;
      const homework = student && subId ? getCuratorHomeworkRecord(student, hwNumber) : undefined;
      if (!student || !homework) {
        await editCuratorScreen(message, 'Работа не найдена.', notFoundKeyboard('Назад', 'c:stud'));
        return true;
      }
      const screen = renderCuratorHomeworkCard(student, homework);
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }

    case 'notif': {
      const students = await loadCuratorStudentsForBot(admin, telegramId);
      const screen = await renderCuratorNotifications(admin, telegramId, students);
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'notv': {
      const notificationId = [id, subId].filter(Boolean).join(':');
      const students = await loadCuratorStudentsForBot(admin, telegramId);
      const screen = notificationId
        ? await renderCuratorNotificationView(admin, telegramId, students, notificationId)
        : null;
      if (!screen) {
        await editCuratorScreen(message, 'Уведомление не найдено.', notFoundKeyboard('Назад', 'c:notif'));
        return true;
      }
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'pre': {
      const students = await loadCuratorStudentsForBot(admin, telegramId);
      const screen = renderCuratorPreLesson(students);
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }

    case 'cab': {
      const screen = await renderCuratorCabinet(admin, telegramId);
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }

    default:
      return false;
  }
}
