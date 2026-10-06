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
import { loadCuratorLibrary } from './curator-library';
import {
  getCuratorHomeworkRecord,
  getCuratorNotificationById,
  getCuratorStudentRecord,
  isCuratorNotificationRead,
  listCuratorStudentLabel,
  listCuratorSubmissionNotifications,
  loadCuratorStudents,
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
  listCuratorThreads,
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
import { getEnrollmentLives } from '../education/lives';
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
  type StaffScreenNav,
} from '../staff/staff-screen-nav';
import {
  renderCuratorAttentionList,
  renderCuratorCourseStudentsBotList,
} from '../staff/curator-activity-screens';
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

type CuratorReplyPayload = AdminPayload & { studentTelegramId?: number };

export const CURATOR_MENU_LABELS = CURATOR_BOT_MENU_LABELS;

export const CURATOR_MENU_LABEL_SET = new Set<string>(Object.values(CURATOR_MENU_LABELS));

const CURATOR_HOME_TEXT =
  '👋 Добро пожаловать в рабочий кабинет District!\n\n' +
  'Здесь вы можете посмотреть учеников, курс и прогресс, домашние задания и сообщения.\n\n' +
  'Выберите нужный раздел:';

async function curatorCabinetScreen(
  admin: SupabaseClient,
  telegramId: number,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const url = await createCabinetLoginUrl(admin, telegramId, '/cabinet/staff');
  return {
    text: '🌐 Кабинет куратора\n\nЗанятия, материалы, эфиры и проверка ДЗ — на сайте:',
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
      [
        { text: CURATOR_MENU_LABELS.students },
        { text: CURATOR_MENU_LABELS.homework },
      ],
      [
        { text: CURATOR_MENU_LABELS.messages },
        { text: CURATOR_MENU_LABELS.course },
      ],
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
    return await createCabinetLoginUrl(admin, telegramId, '/cabinet/staff');
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
  await clearConflictingStaffStates(admin, curatorTelegramId, 'curator_reply');
  try {
    await saveState(
      admin,
      curatorTelegramId,
      { chatId, messageId: 0 },
      STAFF_CURATOR_REPLY_STEP as never,
      { studentTelegramId } as never,
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
  const caps = await loadStaffCapabilities(admin, telegramId);
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: CURATOR_HOME_TEXT + testFooter,
    reply_markup: staffReplyKeyboard(caps),
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

// --- Библиотека учебных материалов (§4) ------------------------------------

export async function renderCuratorLibrary(): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const library = await loadCuratorLibrary();
  if (library.length === 0) {
    return {
      text: '📝 ДОМАШКИ\n\nПока нет опубликованных заданий в программе курса.',
      keyboard: { inline_keyboard: [[backButton('⬅️ Назад', 'c:menu')]] },
    };
  }
  const text = `📝 ДОМАШКИ\n\n📚 Курс\n\n${library.map((w) => `📂 ${w.title}`).join('\n')}`;
  return {
    text,
    keyboard: {
      inline_keyboard: [
        ...library.map((w): InlineButton[] => [{ text: `📂 ${w.title}`, callback_data: `c:libw:${w.id}` }]),
        [backButton('⬅️ Назад', 'c:menu')],
      ],
    },
  };
}

async function findLibraryTask(taskId: string) {
  const library = await loadCuratorLibrary();
  for (const webinar of library) {
    const task = webinar.tasks.find((t) => t.id === taskId);
    if (task) return { webinar, task };
  }
  return null;
}

export async function renderCuratorWebinar(webinarId: string): Promise<{ text: string; keyboard: InlineKeyboard } | null> {
  const library = await loadCuratorLibrary();
  const webinar = library.find((w) => w.id === webinarId);
  if (!webinar) return null;
  const text = `📂 ${webinar.title}\n\n${webinar.tasks.map((t) => `📄 ${t.title}`).join('\n')}`;
  return {
    text,
    keyboard: {
      inline_keyboard: [
        ...webinar.tasks.map((t): InlineButton[] => [{ text: `📄 ${t.title}`, callback_data: `c:libv:${t.id}` }]),
        [backButton('⬅️ Назад', 'c:lib')],
      ],
    },
  };
}

export async function renderCuratorLibraryTask(taskId: string): Promise<{
  text: string;
  keyboard: InlineKeyboard;
  webinarId: string;
} | null> {
  const hit = await findLibraryTask(taskId);
  if (!hit) return null;
  const { webinar, task } = hit;
  return {
    webinarId: webinar.id,
    text: `📄 ${task.title}\n\nУсловие задания:\n\n${task.condition}`,
    keyboard: {
      inline_keyboard: [
        ...(task.fileUrl ? [[{ text: '👀 Открыть файл', url: task.fileUrl }] as InlineButton[]] : []),
        [backButton('⬅️ Назад', `c:libw:${webinar.id}`)],
      ],
    },
  };
}

export async function renderCuratorLibraryFile(taskId: string): Promise<{ text: string; keyboard: InlineKeyboard } | null> {
  const hit = await findLibraryTask(taskId);
  if (!hit?.task.fileUrl) return null;
  return {
    text: `📎 ${hit.task.title}\n\n${hit.task.fileUrl}`,
    keyboard: { inline_keyboard: [[backButton('⬅️ Назад', `c:libv:${taskId}`)]] },
  };
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

export function renderCuratorStudentProfile(
  student: CuratorStudentRecord,
  lives: number | null,
): { text: string; keyboard: InlineKeyboard } {
  const summary = summarizeCuratorStudent(student);

  const enrich = enrichCuratorStudentCard(student);
  const parts = [
    `👨‍🎓 ${student.name}`,
    '',
    `❤️ Жизни на Арене: ${lives ?? '—'}`,
    enrich.progressLine,
    '',
  ];
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
        [{ text: '💬 Написать ученику', callback_data: `c:msg:w:${student.telegramId}` }],
        ...hwButtons,
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
      await deliverStaffToStudent(admin, {
        staffTelegramId: telegramId,
        staffRole: 'curator',
        studentTelegramId: studentId,
        body: text.trim(),
      });
      await clearStateIfAvailable(admin, telegramId);
      await sendAdminMessage(chatId, '✅ Сообщение отправлено ученику.');
    } catch (error) {
      await sendAdminMessage(chatId, error instanceof Error ? error.message : 'Не удалось отправить.');
    }
    return true;
  }

  // Комментарий при отклонении ДЗ текстом (§11).
  if (state && step === STEP_REJECT_TEXT) {
    await clearStateIfAvailable(admin, telegramId);
    const payload = state.payload as RejectPayload;
    const studentId = payload.studentId ?? '';
    const hwNumber = payload.hwNumber ?? 0;
    const students = await loadCuratorStudents(admin, telegramId);
    const student = getCuratorStudentRecord(students, studentId);
    if (!student) {
      await sendAdminMessage(chatId, 'Не удалось найти работу.');
      return true;
    }
    try {
      const { lesson, lifeDeduction } = await rejectCourseHomeworkByCurator(
        admin,
        telegramId,
        student.telegramId,
        hwNumber,
        text,
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

  if (!CURATOR_MENU_LABEL_SET.has(text)) {
    if (state && (step === STAFF_CURATOR_REPLY_STEP || step === STEP_REJECT_TEXT)) {
      return false;
    }
    await sendAdminMessage(chatId, CURATOR_UNKNOWN_TEXT);
    return true;
  }

  const cabinetUrl = await curatorCabinetUrl(admin, telegramId);

  if (text === CURATOR_MENU_LABELS.cabinet) {
    const screen = await renderCuratorCabinet(admin, telegramId);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === CURATOR_MENU_LABELS.messages) {
    const { threads, storageEnabled } = await listCuratorThreads(admin, telegramId);
    const screen = renderCuratorMessagesInbox(threads, storageEnabled, cabinetUrl);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === CURATOR_MENU_LABELS.homework) {
    const screen = renderCuratorHomeworkHub(cabinetUrl);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === CURATOR_MENU_LABELS.course) {
    const snapshot = await loadCuratorActivitySnapshot(admin, telegramId);
    const screen = renderCuratorActivityHome(snapshot, cabinetUrl, undefined);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  const students = await loadCuratorStudents(admin, telegramId);
  const screen = renderCuratorStudentsList(students);
  await sendAdminMessage(chatId, screen.text, screen.keyboard);
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
      await deliverStaffToStudent(admin, {
        staffTelegramId: telegramId,
        staffRole: 'curator',
        studentTelegramId: studentId,
        body: '',
        attachmentRef: formatTelegramFileRef(fileId),
        attachmentKind: kind,
      });
      await clearStateIfAvailable(admin, telegramId);
      await sendAdminMessage(chatId, '✅ Вложение отправлено ученику.');
    } catch (error) {
      await sendAdminMessage(chatId, error instanceof Error ? error.message : 'Не удалось отправить.');
    }
    return true;
  }

  if (kind === 'document') return false;

  const expected = kind === 'voice' ? STEP_REJECT_VOICE : STEP_REJECT_PHOTO;
  if (!state || step !== expected) return false;

  await clearStateIfAvailable(admin, telegramId);
  const payload = state.payload as RejectPayload;
  const studentId = payload.studentId ?? '';
  const hwNumber = payload.hwNumber ?? 0;
  const students = await loadCuratorStudents(admin, telegramId);
  const student = getCuratorStudentRecord(students, studentId);
  if (!student) {
    await sendAdminMessage(chatId, 'Не удалось найти работу.');
    return true;
  }
  try {
    const { lesson, lifeDeduction } = await rejectCourseHomeworkByCurator(
      admin,
      telegramId,
      student.telegramId,
      hwNumber,
    );
    const mediaNote =
      kind === 'voice'
        ? 'Голосовой комментарий от куратора — см. сообщение ниже.'
        : 'Комментарий на фото от куратора — см. сообщение ниже.';
    await notifyStudentHomeworkReviewed(admin, student.telegramId, {
      lessonNumber: lesson.lessonNumber,
      title: lesson.title,
      approved: false,
      note: mediaNote,
    });

    const { data: studentMember } = await admin
      .from('bot_members')
      .select('chat_id')
      .eq('telegram_id', student.telegramId)
      .maybeSingle();
    const studentChatId = studentMember?.chat_id as number | undefined;
    if (studentChatId) {
      if (kind === 'voice') {
        await telegramSend('sendVoice', { chat_id: studentChatId, voice: fileId });
      } else {
        await telegramSend('sendPhoto', { chat_id: studentChatId, photo: fileId });
      }
    }

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

export async function handleCuratorCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!data.startsWith('c:')) return false;
  if (!(await canUseCuratorBot(admin, telegramId))) return false;

  const message: AdminMessage = { chatId, messageId };
  const handled = await routeCuratorCallback(admin, message, telegramId, data.split(':'));
  if (!handled) return false;

  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }
  return true;
}

async function loadStudentLives(
  admin: SupabaseClient,
  studentTelegramId: number,
): Promise<number | null> {
  const content = await getDistrictCourseContent();
  if (!content) return null;
  const courseId = await resolveCourseIdForContent(admin, content);
  if (!courseId) return null;
  const lives = await getEnrollmentLives(admin, studentTelegramId, courseId);
  return lives?.lives_current ?? null;
}

async function routeCuratorCallback(
  admin: SupabaseClient,
  message: AdminMessage,
  telegramId: number,
  parts: string[],
): Promise<boolean> {
  const [, action, id, subId] = parts;
  const hwNumber = Number(subId);
  const cabinetUrl = await curatorCabinetUrl(admin, telegramId);
  const caps = await loadStaffCapabilities(admin, telegramId);
  const combined = resolveStaffBotMode(caps) === 'combined';
  const hwNav: StaffScreenNav | undefined = combined ? COMBINED_CURATOR_HW_NAV : undefined;
  const msgNav: StaffScreenNav | undefined = combined ? COMBINED_CURATOR_MSG_NAV : undefined;
  const courseNav: StaffScreenNav | undefined = combined ? COMBINED_CURATOR_COURSE_NAV : undefined;

  switch (action) {
    case 'menu': {
      if (combined) {
        await editCuratorScreen(message, COMBINED_HOME_TEXT, { inline_keyboard: [] });
      } else {
        await editCuratorScreen(message, CURATOR_HOME_TEXT, { inline_keyboard: [] });
      }
      return true;
    }

    case 'hw': {
      if (id === 'q' && subId) {
        const queue = subId as CuratorHomeworkQueueKind;
        const students = await loadCuratorStudents(admin, telegramId);
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
      if (id === 'review') {
        const students = await loadCuratorStudents(admin, telegramId);
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
      if (id === 'l') {
        const { threads, storageEnabled } = await listCuratorThreads(admin, telegramId);
        const screen = renderCuratorMessagesInbox(threads, storageEnabled, cabinetUrl, msgNav);
        await editCuratorScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (id === 'u') {
        const { threads, storageEnabled } = await listCuratorThreads(admin, telegramId);
        const screen = renderCuratorUnreadThreadsInbox(threads, storageEnabled, cabinetUrl, msgNav);
        await editCuratorScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (id === 'd' && subId) {
        const studentId = Number(subId);
        if (!Number.isFinite(studentId)) return true;
        await markCuratorThreadRead(admin, telegramId, studentId);
        const label = await staffStudentLabel(admin, studentId);
        const { messages, storageEnabled } = await loadCuratorThreadMessages(admin, telegramId, studentId);
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

    // Библиотека: корень → вебинар → задание → файл-заглушка.
    case 'lib': {
      const screen = await renderCuratorLibrary();
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'libw': {
      const screen = id ? await renderCuratorWebinar(id) : null;
      if (!screen) {
        await editCuratorScreen(message, 'Вебинар не найден.', notFoundKeyboard('Назад', 'c:lib'));
        return true;
      }
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'libv': {
      const screen = id ? await renderCuratorLibraryTask(id) : null;
      if (!screen) {
        await editCuratorScreen(message, 'Задание не найдено.', notFoundKeyboard('Назад', 'c:lib'));
        return true;
      }
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'libf': {
      const screen = id ? await renderCuratorLibraryFile(id) : null;
      if (!screen) {
        await editCuratorScreen(message, 'Задание не найдено.', notFoundKeyboard('Назад', 'c:lib'));
        return true;
      }
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }

    // Ученики: список → профиль → карточка ДЗ.
    case 'stud': {
      const students = await loadCuratorStudents(admin, telegramId);
      const screen = renderCuratorStudentsList(students);
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'sp': {
      const students = await loadCuratorStudents(admin, telegramId);
      const student = id ? getCuratorStudentRecord(students, id) : undefined;
      if (!student) {
        await editCuratorScreen(message, 'Ученик не найден.', notFoundKeyboard('Назад', 'c:stud'));
        return true;
      }
      const lives = await loadStudentLives(admin, student.telegramId);
      const screen = renderCuratorStudentProfile(student, lives);
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'shw': {
      const students = await loadCuratorStudents(admin, telegramId);
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
      const students = await loadCuratorStudents(admin, telegramId);
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
      const students = await loadCuratorStudents(admin, telegramId);
      const student = id ? getCuratorStudentRecord(students, id) : undefined;
      if (!student) {
        await editCuratorScreen(message, 'Работа не найдена.', notFoundKeyboard('Назад', 'c:stud'));
        return true;
      }
      try {
        const { lesson } = await approveCourseHomeworkByCurator(
          admin,
          telegramId,
          student.telegramId,
          hwNumber,
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
      const students = await loadCuratorStudents(admin, telegramId);
      const student = id ? getCuratorStudentRecord(students, id) : undefined;
      if (!student) {
        await editCuratorScreen(message, 'Работа не найдена.', notFoundKeyboard('Назад', 'c:stud'));
        return true;
      }
      try {
        const { lesson, lifeDeduction } = await rejectCourseHomeworkByCurator(
          admin,
          telegramId,
          student.telegramId,
          hwNumber,
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
      const students = await loadCuratorStudents(admin, telegramId);
      const student = id ? getCuratorStudentRecord(students, id) : undefined;
      const homework = student && subId ? getCuratorHomeworkRecord(student, hwNumber) : undefined;
      if (!student || !homework) {
        await editCuratorScreen(message, 'Работа не найдена.', notFoundKeyboard('Назад', 'c:stud'));
        return true;
      }
      if (homework.status !== 'waiting') {
        await editCuratorScreen(
          message,
          'Снять жизнь можно только за несданное домашнее задание.',
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
          'notSubmitted',
        );
        const note = lifeDeduction?.deducted
          ? `❤️ Жизнь снята за ДЗ №${hwNumber}.`
          : lifeDeduction
            ? `Жизнь за это ДЗ уже была снята ранее.`
            : 'Не удалось обновить жизни.';
        const tail = lifeDeduction
          ? `\n\nОсталось: ${lifeDeduction.livesCurrent} из ${lifeDeduction.livesMax}.` +
            (lifeDeduction.accessBlocked ? '\n\n⚠️ Доступ к урокам заблокирован.' : '')
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
      const students = await loadCuratorStudents(admin, telegramId);
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
      const students = await loadCuratorStudents(admin, telegramId);
      const screen = await renderCuratorNotifications(admin, telegramId, students);
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'notv': {
      const notificationId = [id, subId].filter(Boolean).join(':');
      const students = await loadCuratorStudents(admin, telegramId);
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
      const students = await loadCuratorStudents(admin, telegramId);
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
