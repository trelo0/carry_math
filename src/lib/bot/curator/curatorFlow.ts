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
import {
  CURATOR_HW_STATUS_LABELS,
  CURATOR_HW_STATUS_SHORT,
  CURATOR_LIBRARY,
  CURATOR_PRE_LESSON_SUMMARY,
} from './mock-data';
import {
  getCuratorHomework,
  getCuratorNewSubmissions,
  getCuratorNotification,
  getCuratorStudent,
  getCuratorStudentLives,
  getCuratorStudentListLabel,
  getCuratorStudentSummary,
  getCuratorStudents,
  isCuratorNotificationRead,
  markCuratorNotificationRead,
  setCuratorHomeworkStatus,
} from './mock-state';

// ---------------------------------------------------------------------------
// Кабинет ментора (role = curator). Этап проверки UX на MOCK-данных.
//
// Архитектура та же, что у админки и кабинета преподавателя:
// • Reply Keyboard — постоянное главное меню под полем ввода;
// • Inline Keyboard — экраны разделов, навигация через editMessageText;
// • новое сообщение — результаты действий (одобрение/отклонение ДЗ,
//   ответ на текст/голос/фото), чтобы результат был под сообщением ментора.
//
// Все данные — mock-data.ts / mock-state.ts: статусы меняются только
// в памяти процесса, в Supabase ничего не пишется, ученикам ничего
// не отправляется.
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
  'Разделы — на кнопках меню под полем ввода. Сейчас интерфейс работает на тестовых данных.';

const CURATOR_CABINET_TEXT =
  '🌐 Личный кабинет\n\nСсылка на личный кабинет будет подключена после готовности сайта.';

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

export function renderCuratorLibrary(): { text: string; keyboard: InlineKeyboard } {
  const text = `📝 ДОМАШКИ\n\n📚 Курс\n\n${CURATOR_LIBRARY.map((w) => `📂 ${w.title}`).join('\n')}`;
  return {
    text,
    keyboard: {
      inline_keyboard: [
        ...CURATOR_LIBRARY.map((w): InlineButton[] => [{ text: `📂 ${w.title}`, callback_data: `c:libw:${w.id}` }]),
        [backButton('⬅️ Назад', 'c:menu')],
      ],
    },
  };
}

export function renderCuratorWebinar(webinarId: string): { text: string; keyboard: InlineKeyboard } | null {
  const webinar = CURATOR_LIBRARY.find((w) => w.id === webinarId);
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

export function renderCuratorLibraryTask(taskId: string): {
  text: string;
  keyboard: InlineKeyboard;
  webinarId: string;
} | null {
  for (const webinar of CURATOR_LIBRARY) {
    const task = webinar.tasks.find((t) => t.id === taskId);
    if (task) {
      return {
        webinarId: webinar.id,
        text: `📄 ${task.title}\n\nУсловие задания:\n\n${task.condition}\n\n📎 Файл с условием`,
        keyboard: {
          inline_keyboard: [
            [{ text: '👀 Посмотреть', callback_data: `c:libf:${task.id}` }],
            [backButton('⬅️ Назад', `c:libw:${webinar.id}`)],
          ],
        },
      };
    }
  }
  return null;
}

export function renderCuratorLibraryFile(taskId: string): { text: string; keyboard: InlineKeyboard } | null {
  const task = renderCuratorLibraryTask(taskId);
  if (!task) return null;
  return {
    text: '📎 Файл с условием\n\nВ реальной версии здесь будет файл задания.',
    keyboard: { inline_keyboard: [[backButton('⬅️ Назад', `c:libv:${taskId}`)]] },
  };
}

// --- Ученики (§5, §6) -------------------------------------------------------

export function renderCuratorStudentsList(): { text: string; keyboard: InlineKeyboard } {
  const students = getCuratorStudents();
  const text = `👨‍🎓 УЧЕНИКИ\n\n${students.map((s) => getCuratorStudentListLabel(s)).join('\n')}`;
  return {
    text,
    keyboard: {
      inline_keyboard: [
        ...students.map((s): InlineButton[] => [
          { text: getCuratorStudentListLabel(s), callback_data: `c:sp:${s.id}` },
        ]),
        [backButton('⬅️ Назад', 'c:menu')],
      ],
    },
  };
}

export function renderCuratorStudentProfile(studentId: string): { text: string; keyboard: InlineKeyboard } | null {
  const student = getCuratorStudent(studentId);
  if (!student) return null;
  const summary = getCuratorStudentSummary(student);
  const lives = getCuratorStudentLives(studentId);

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
  studentId: string,
  hwNumber: number,
): { text: string; keyboard: InlineKeyboard } | null {
  const student = getCuratorStudent(studentId);
  const homework = getCuratorHomework(studentId, hwNumber);
  if (!student || !homework) return null;
  const text =
    '📝 ДОМАШНЕЕ ЗАДАНИЕ\n\n' +
    `Ученик: ${student.name}\n` +
    `Задание: ДЗ №${hwNumber}\n` +
    `Статус: ${CURATOR_HW_STATUS_LABELS[homework.status]}\n\n` +
    '📎 Работа ученика';
  return {
    text,
    keyboard: {
      inline_keyboard: [
        [{ text: '👀 Посмотреть', callback_data: `c:vieww:${studentId}:${hwNumber}` }],
        [{ text: '✅ ОДОБРИТЬ', callback_data: `c:appr:${studentId}:${hwNumber}` }],
        [{ text: '❌ ОТКЛОНИТЬ', callback_data: `c:rej:${studentId}:${hwNumber}` }],
        [backButton('⬅️ Назад', `c:sp:${studentId}`)],
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

export function renderCuratorNotifications(): { text: string; keyboard: InlineKeyboard } {
  const notifications = getCuratorNewSubmissions();
  const unread = notifications.filter((n) => !isCuratorNotificationRead(n.id));

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
    (n): InlineButton[] => [
      {
        text: `${isCuratorNotificationRead(n.id) ? '✓' : '📎'} ${n.studentName} — ДЗ №${n.hwNumber}`,
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

export function renderCuratorNotificationView(notificationId: string): {
  text: string;
  keyboard: InlineKeyboard;
} | null {
  const notification = getCuratorNotification(notificationId);
  if (!notification) return null;
  markCuratorNotificationRead(notificationId);
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

export function renderCuratorPreLesson(): { text: string; keyboard: InlineKeyboard } {
  const summary = CURATOR_PRE_LESSON_SUMMARY;
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
  return {
    text: CURATOR_CABINET_TEXT,
    keyboard: { inline_keyboard: [[backButton('⬅️ Назад', 'c:menu')]] },
  };
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
    const student = getCuratorStudent(studentId);
    if (!student || !setCuratorHomeworkStatus(studentId, hwNumber, 'rejected', text)) {
      await sendAdminMessage(chatId, 'Не удалось найти работу в тестовых данных.');
      return true;
    }
    await sendAdminMessage(
      chatId,
      '❌ ДЗ отклонено.\n\n' +
        `Ученик: ${student.name}\n\n` +
        `Комментарий:\n«${text}»\n\n` +
        'В реальной версии сообщение будет отправлено ученику через Telegram-бота.',
      { inline_keyboard: [[backButton('⬅️ Назад', `c:sp:${studentId}`)]] },
    );
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
    const screen = renderCuratorLibrary();
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === CURATOR_MENU_LABELS.students) {
    const screen = renderCuratorStudentsList();
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  const screen = renderCuratorNotifications();
  await sendAdminMessage(chatId, screen.text, screen.keyboard);
  return true;
}

// ---------------------------------------------------------------------------
// Вложения: голосовое (§12) или фото (§13) как комментарий при отклонении.
// Реальному ученику ничего не отправляется — только тестовый результат.
// ---------------------------------------------------------------------------

export async function handleCuratorAttachment(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  kind: 'voice' | 'photo',
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
  const student = getCuratorStudent(studentId);
  if (!student || !setCuratorHomeworkStatus(studentId, hwNumber, 'rejected')) {
    await sendAdminMessage(chatId, 'Не удалось найти работу в тестовых данных.');
    return true;
  }

  const receivedText =
    kind === 'voice'
      ? '✅ Тестовое голосовое сообщение принято.\n\nВ реальной версии оно будет отправлено ученику вместе с уведомлением о доработке.'
      : '✅ Тестовая фотография принята.\n\nВ реальной версии она будет отправлена ученику вместе с комментарием.';
  await sendAdminMessage(
    chatId,
    `❌ ДЗ отклонено.\n\nУченик: ${student.name}\nДЗ: №${hwNumber}\n\n${receivedText}`,
    { inline_keyboard: [[backButton('⬅️ Назад', `c:sp:${studentId}`)]] },
  );
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
      const screen = renderCuratorLibrary();
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'libw': {
      const screen = id ? renderCuratorWebinar(id) : null;
      if (!screen) {
        await editCuratorScreen(message, 'Вебинар не найден.', notFoundKeyboard('Назад', 'c:lib'));
        return true;
      }
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'libv': {
      const screen = id ? renderCuratorLibraryTask(id) : null;
      if (!screen) {
        await editCuratorScreen(message, 'Задание не найдено.', notFoundKeyboard('Назад', 'c:lib'));
        return true;
      }
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'libf': {
      const screen = id ? renderCuratorLibraryFile(id) : null;
      if (!screen) {
        await editCuratorScreen(message, 'Задание не найдено.', notFoundKeyboard('Назад', 'c:lib'));
        return true;
      }
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }

    // Ученики: список → профиль → карточка ДЗ.
    case 'stud': {
      const screen = renderCuratorStudentsList();
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'sp': {
      const screen = id ? renderCuratorStudentProfile(id) : null;
      if (!screen) {
        await editCuratorScreen(message, 'Ученик не найден.', notFoundKeyboard('Назад', 'c:stud'));
        return true;
      }
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'shw': {
      const screen = id && subId ? renderCuratorHomeworkCard(id, hwNumber) : null;
      if (!screen) {
        await editCuratorScreen(message, 'Работа не найдена.', notFoundKeyboard('Назад', 'c:stud'));
        return true;
      }
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }

    // Просмотр работы ученика — заглушка новым сообщением.
    case 'vieww': {
      await sendAdminMessage(
        message.chatId,
        '📎 Работа ученика\n\nВ реальной версии здесь будет файл работы ученика.',
        { inline_keyboard: [[backButton('⬅️ Назад', `c:shw:${id}:${subId}`)]] },
      );
      return true;
    }

    // Одобрение (§9): меняем только mock state, профиль покажет новый статус.
    case 'appr': {
      const student = id ? getCuratorStudent(id) : undefined;
      if (!student || !setCuratorHomeworkStatus(id, hwNumber, 'approved')) {
        await editCuratorScreen(message, 'Работа не найдена.', notFoundKeyboard('Назад', 'c:stud'));
        return true;
      }
      await sendAdminMessage(
        message.chatId,
        `✅ Домашнее задание одобрено.\n\nУченик: ${student.name}\nДЗ: №${hwNumber}`,
        { inline_keyboard: [[backButton('⬅️ Назад', `c:sp:${id}`)]] },
      );
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
      const student = id ? getCuratorStudent(id) : undefined;
      if (!student || !setCuratorHomeworkStatus(id, hwNumber, 'rejected')) {
        await editCuratorScreen(message, 'Работа не найдена.', notFoundKeyboard('Назад', 'c:stud'));
        return true;
      }
      await sendAdminMessage(
        message.chatId,
        `❌ ДЗ отклонено.\n\nУченик: ${student.name}\nДЗ: №${hwNumber}\n\nКомментарий: без комментария.`,
        { inline_keyboard: [[backButton('⬅️ Назад', `c:sp:${id}`)]] },
      );
      return true;
    }
    case 'rejc': {
      await clearStateIfAvailable(admin, telegramId);
      const screen = id && subId ? renderCuratorHomeworkCard(id, hwNumber) : null;
      if (!screen) {
        await editCuratorScreen(message, 'Работа не найдена.', notFoundKeyboard('Назад', 'c:stud'));
        return true;
      }
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }

    // Уведомления (§14, §15) и контроль перед занятием (§16).
    case 'notif': {
      const screen = renderCuratorNotifications();
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'notv': {
      // id уведомления содержит двоеточие (studentId:номер) — собираем обратно.
      const notificationId = [id, subId].filter(Boolean).join(':');
      const screen = notificationId ? renderCuratorNotificationView(notificationId) : null;
      if (!screen) {
        await editCuratorScreen(message, 'Уведомление не найдено.', notFoundKeyboard('Назад', 'c:notif'));
        return true;
      }
      await editCuratorScreen(message, screen.text, screen.keyboard);
      return true;
    }
    case 'pre': {
      const screen = renderCuratorPreLesson();
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
