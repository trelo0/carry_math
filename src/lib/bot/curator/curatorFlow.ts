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
import { getStudentCabinetUrl } from '../studentFlow';
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

export const CURATOR_MENU_LABELS = {
  homework: '📝 ДОМАШКИ',
  students: '👨‍🎓 УЧЕНИКИ',
  notifications: '🔔 УВЕДОМЛЕНИЯ',
  cabinet: '👤 ЛИЧНЫЙ КАБИНЕТ',
} as const;

export const CURATOR_MENU_LABEL_SET = new Set<string>(Object.values(CURATOR_MENU_LABELS));

const CURATOR_HOME_TEXT =
  '🧑‍🏫 Кабинет ментора District\n\n' +
  'Разделы — на кнопках меню под полем ввода.';

function curatorCabinetScreen(): { text: string; keyboard: InlineKeyboard } {
  return {
    text: '🌐 Личный кабинет\n\nОткрой кабинет на сайте District:',
    keyboard: {
      inline_keyboard: [
        [{ text: '🌐 Открыть личный кабинет', url: getStudentCabinetUrl() }],
        [backButton('⬅️ Назад', 'c:menu')],
      ],
    },
  };
}

const CURATOR_UNKNOWN_TEXT =
  'Я не понял это сообщение.\n\nРазделы кабинета — на кнопках меню под полем ввода.';

// Шаги диалогов отклонения ДЗ (общая таблица bot_conversation_states).
const STEP_REJECT_TEXT = 'curator:reject-text';
const STEP_REJECT_VOICE = 'curator:reject-voice';
const STEP_REJECT_PHOTO = 'curator:reject-photo';

type RejectPayload = AdminPayload & { studentId?: string; hwNumber?: number };

// ---------------------------------------------------------------------------
// Главное меню (Reply Keyboard)
// ---------------------------------------------------------------------------

export function curatorReplyKeyboard(): ReplyKeyboard {
  return {
    keyboard: [
      [{ text: CURATOR_MENU_LABELS.homework }],
      [{ text: CURATOR_MENU_LABELS.students }],
      [{ text: CURATOR_MENU_LABELS.notifications }],
      [{ text: CURATOR_MENU_LABELS.cabinet }],
    ],
    resize_keyboard: true,
  };
}

// /start для роли curator: приветствие + постоянное меню.
export async function sendCuratorStart(chatId: number, testFooter = ''): Promise<void> {
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: CURATOR_HOME_TEXT + testFooter,
    reply_markup: curatorReplyKeyboard(),
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

export function renderCuratorStudentsList(students: CuratorStudentRecord[]): { text: string; keyboard: InlineKeyboard } {
  if (students.length === 0) {
    return {
      text: '👨‍🎓 УЧЕНИКИ\n\nПока нет закреплённых учеников.',
      keyboard: { inline_keyboard: [[backButton('⬅️ Назад', 'c:menu')]] },
    };
  }
  const text = `👨‍🎓 УЧЕНИКИ\n\n${students.map((s) => listCuratorStudentLabel(s)).join('\n')}`;
  return {
    text,
    keyboard: {
      inline_keyboard: [
        ...students.map((s): InlineButton[] => [
          { text: listCuratorStudentLabel(s), callback_data: `c:sp:${s.id}` },
        ]),
        [backButton('⬅️ Назад', 'c:menu')],
      ],
    },
  };
}

export function renderCuratorStudentProfile(
  student: CuratorStudentRecord,
  lives: number | null,
): { text: string; keyboard: InlineKeyboard } {
  const summary = summarizeCuratorStudent(student);

  const parts = [`👨‍🎓 ${student.name}`, '', `❤️ Жизни на Арене: ${lives ?? '—'}`, ''];
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
      inline_keyboard: [...hwButtons, [backButton('⬅️ Назад', 'c:stud')]],
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

export function renderCuratorCabinet(): { text: string; keyboard: InlineKeyboard } {
  return curatorCabinetScreen();
}

// ---------------------------------------------------------------------------
// Эффективная роль: тестер с маской /as curator видит кабинет ментора.
// ---------------------------------------------------------------------------

async function effectiveCuratorRole(admin: SupabaseClient, telegramId: number): Promise<string> {
  const { data, error } = await admin
    .from('bot_members')
    .select('role, view_role')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return 'guest';
  const role = String(data.role);
  const viewRole = data.view_role as string | null;
  if (role === 'test' && viewRole && viewRole !== 'test') return viewRole;
  return role;
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
  const role = await effectiveCuratorRole(admin, telegramId);
  if (role !== 'curator') return false;

  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  // Комментарий при отклонении ДЗ текстом (§11).
  const step = state?.step as string | undefined;
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

  if (!CURATOR_MENU_LABEL_SET.has(text)) {
    await sendAdminMessage(chatId, CURATOR_UNKNOWN_TEXT);
    return true;
  }

  if (text === CURATOR_MENU_LABELS.cabinet) {
    const screen = renderCuratorCabinet();
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === CURATOR_MENU_LABELS.homework) {
    const screen = await renderCuratorLibrary();
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === CURATOR_MENU_LABELS.students) {
    const students = await loadCuratorStudents(admin, telegramId);
    const screen = renderCuratorStudentsList(students);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  const students = await loadCuratorStudents(admin, telegramId);
  const screen = await renderCuratorNotifications(admin, telegramId, students);
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
  kind: 'voice' | 'photo',
  fileId: string,
): Promise<boolean> {
  const role = await effectiveCuratorRole(admin, telegramId);
  if (role !== 'curator') return false;

  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
  const step = state?.step as string | undefined;
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
  const role = await effectiveCuratorRole(admin, telegramId);
  if (role !== 'curator') return false;

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

  switch (action) {
    case 'menu': {
      await editCuratorScreen(message, CURATOR_HOME_TEXT, { inline_keyboard: [] });
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
          text: '✏️ Напишите комментарий ученику.\n\nПосле отправки он будет показан как тестовое сообщение.\n\n⬅️ Отмена',
        },
        rejv: {
          step: STEP_REJECT_VOICE,
          text: '🎤 Отправьте голосовое сообщение.\n\nВ тестовой версии обработка голосовых является заглушкой.\n\n⬅️ Отмена',
        },
        rejp: {
          step: STEP_REJECT_PHOTO,
          text: '📷 Отправьте фотографию.\n\nВ тестовой версии изображение не будет отправлено ученику.\n\n⬅️ Отмена',
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
      const screen = renderCuratorCabinet();
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }

    default:
      return false;
  }
}
