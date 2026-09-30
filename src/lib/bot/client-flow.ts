import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { getBaseUrlString } from '@/lib/siteUrl';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import { beginStudentPurchase } from './studentPurchaseFlow';
import { beginStudentSupport } from './studentSupportFlow';
import {
  beginClientLeadForm,
  handleClientLeadCallback,
  isClientLeadCallback,
} from './client-lead-flow';
import {
  handleClientLessonsCallback,
  isClientLessonsCallback,
  showClientLessonsMenu,
  showClientPackageMenu,
  showClientScheduleMenu,
} from './client-lessons-flow';
import {
  handleClientLessonHomeworkCallback,
  isClientLessonHomeworkCallback,
} from './client-lesson-homework-flow';
import { resolveClientState, type ClientStateSnapshot } from './client-state';
import {
  buildClientReplyKeyboard,
  buildClientWelcomeText,
  CLIENT_LABELS,
  isClientReplyLabel,
} from './client-menu';
import {
  clientHomeButton,
  editHubMessage,
  loadClientHub,
  resetClientDialogToHub,
  saveClientHub,
  sendHubMessage,
} from './client-nav';
import type { BotRole } from './roles';
import { beginStudentMentorQuestion } from './studentMentorFlow';

function courseInfoUrl(): string {
  return process.env.NEXT_PUBLIC_BOT_COURSE_INFO_URL?.trim() || `${getBaseUrlString()}/cabinet`;
}

function stubKeyboard() {
  return { inline_keyboard: [[clientHomeButton()]] };
}

async function showHubScreen(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  screenId: string,
  text: string,
  keyboard: { inline_keyboard: Array<Array<Record<string, string>>> },
): Promise<void> {
  const existing = await loadClientHub(admin, telegramId);
  if (existing) {
    const ok = await editHubMessage(existing, text, keyboard);
    if (ok) {
      await saveClientHub(admin, telegramId, existing, screenId);
      return;
    }
  }
  const messageId = await sendHubMessage(chatId, text, keyboard);
  if (messageId) {
    await saveClientHub(admin, telegramId, { chatId, messageId }, screenId);
  }
}

async function showOnlineCourseScreen(
  admin: SupabaseClient,
  state: ClientStateSnapshot,
  chatId: number,
): Promise<void> {
  const lines = [
    '🎓 Онлайн-курс District',
    '',
    'Подготовка к ЦТ по математике: вебинары, практика и домашние задания с поддержкой куратора.',
    '',
    'Для кого: школьники, которые готовятся к экзаменам и хотят системную программу.',
    '',
    'Покупка, оплата и прохождение — на сайте в личном кабинете.',
  ];

  const keyboard: { inline_keyboard: Array<Array<Record<string, string>>> } = {
    inline_keyboard: [],
  };

  if (state.hasActiveCourse) {
    const cabinetUrl = await createCabinetLoginUrl(admin, state.telegramId, '/cabinet?section=course');
    keyboard.inline_keyboard.push([{ text: '🌐 Открыть курс в кабинете', url: cabinetUrl }]);
    keyboard.inline_keyboard.push([{ text: '💬 Вопрос куратору по курсу', callback_data: 'cl:course:ask' }]);
  } else {
    keyboard.inline_keyboard.push([{ text: '🌐 Подробнее на сайте', url: courseInfoUrl() }]);
  }
  keyboard.inline_keyboard.push([clientHomeButton()]);

  await showHubScreen(admin, state.telegramId, chatId, 'course', lines.join('\n'), keyboard);
}

async function showBuyHub(
  admin: SupabaseClient,
  state: ClientStateSnapshot,
  chatId: number,
): Promise<void> {
  const text =
    '💳 Купить обучение\n\n' +
    '🎓 Онлайн-курс — оплата и доступ через личный кабинет на сайте.\n\n' +
    '📚 Индивидуальные и 👥 групповые занятия — заявка и согласование с администратором.';
  const keyboard = {
    inline_keyboard: [
      [{ text: '🎓 Онлайн-курс', callback_data: 'cl:buy:course' }],
      [{ text: '📚 Индивидуальные занятия', callback_data: 'cl:buy:individual' }],
      [{ text: '👥 Групповые занятия', callback_data: 'cl:buy:group' }],
      [clientHomeButton()],
    ],
  };
  await showHubScreen(admin, state.telegramId, chatId, 'buy', text, keyboard);
}

async function showBuyFormatHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  format: 'individual' | 'group',
): Promise<void> {
  const title = format === 'individual' ? 'Индивидуальные занятия' : 'Групповые занятия';
  const text =
    `📚 ${title}\n\n` +
    'Подбор преподавателя, расписание и оплата — после заявки с вами свяжется администратор.\n\n' +
    'Можно оформить заявку в боте или написать администратору напрямую.';
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '📝 Оставить заявку',
          callback_data: format === 'individual' ? 'cl:lead:fmt:individual' : 'cl:lead:fmt:group',
        },
      ],
      [{ text: '💬 Связаться с администратором', callback_data: 'cl:lead:goto:support' }],
      [clientHomeButton()],
    ],
  };
  await showHubScreen(admin, telegramId, chatId, `buy-${format}`, text, keyboard);
}

async function showHomeHub(
  admin: SupabaseClient,
  state: ClientStateSnapshot,
  chatId: number,
  testFooter = '',
): Promise<void> {
  const text =
    buildClientWelcomeText(state, testFooter) +
    '\n\nВыберите действие в меню под полем ввода или кнопку ниже.';
  await showHubScreen(admin, state.telegramId, chatId, 'home', text, stubKeyboard());
}

/** /start и /menu для клиентского UI (guest/student). */
export async function sendClientStart(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  options?: { testFooter?: string; memberRole?: BotRole },
): Promise<void> {
  const state = await resolveClientState(admin, telegramId, { memberRole: options?.memberRole });
  const welcome = buildClientWelcomeText(state, options?.testFooter ?? '');
  const replyMarkup = buildClientReplyKeyboard(state);

  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: welcome,
    reply_markup: replyMarkup,
  });

  await showHomeHub(admin, state, chatId, options?.testFooter);
}

/** Обновить Reply-меню после покупки, привязки и т.д. (без дубля welcome+/start). */
export async function refreshClientMenu(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  memberRole?: BotRole,
): Promise<void> {
  const state = await resolveClientState(admin, telegramId, { memberRole });
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: buildClientWelcomeText(state),
    reply_markup: buildClientReplyKeyboard(state),
  });
  await showHomeHub(admin, state, chatId);
}

export async function handleClientMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
  memberRole?: BotRole,
): Promise<boolean> {
  if (!isClientReplyLabel(text)) return false;

  const state = await resolveClientState(admin, telegramId, { memberRole });

  switch (text) {
    case CLIENT_LABELS.onlineCourse:
      await showOnlineCourseScreen(admin, state, chatId);
      return true;
    case CLIENT_LABELS.leaveRequest:
      await beginClientLeadForm(admin, telegramId, chatId);
      return true;
    case CLIENT_LABELS.contactAdmin:
      await beginStudentSupport(admin, telegramId, chatId);
      return true;
    case CLIENT_LABELS.buy:
      await showBuyHub(admin, state, chatId);
      return true;
    case CLIENT_LABELS.myLessons:
      await showClientLessonsMenu(admin, telegramId, chatId);
      return true;
    case CLIENT_LABELS.schedule:
      await showClientScheduleMenu(admin, telegramId, chatId);
      return true;
    case CLIENT_LABELS.myPackage:
      await showClientPackageMenu(admin, telegramId, chatId);
      return true;
    default:
      return false;
  }
}

export function isClientCallback(data: string): boolean {
  return data.startsWith('cl:');
}

export async function handleClientCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
  memberRole?: BotRole,
): Promise<boolean> {
  if (!isClientCallback(data)) return false;

  if (isClientLeadCallback(data)) {
    return handleClientLeadCallback(admin, data, chatId, messageId, telegramId, callbackQueryId);
  }

  if (isClientLessonsCallback(data)) {
    return handleClientLessonsCallback(admin, data, chatId, messageId, telegramId, callbackQueryId);
  }

  if (isClientLessonHomeworkCallback(data)) {
    return handleClientLessonHomeworkCallback(admin, data, chatId, messageId, telegramId, callbackQueryId);
  }

  const known =
    data === 'cl:home' ||
    data === 'cl:back' ||
    data === 'cl:course:site' ||
    data === 'cl:buy:course' ||
    data === 'cl:buy:individual' ||
    data === 'cl:buy:group' ||
    data === 'cl:course:ask';

  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }

  const state = await resolveClientState(admin, telegramId, { memberRole });

  if (!known) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'Эта кнопка больше не активна. Актуальное меню — ниже.',
      reply_markup: buildClientReplyKeyboard(state),
    });
    return true;
  }
  if (data === 'cl:home' || data === 'cl:back') {
    await resetClientDialogToHub(admin, telegramId);
    let hubState = await loadClientHub(admin, telegramId);
    if (!hubState) {
      hubState = { chatId, messageId };
      await saveClientHub(admin, telegramId, hubState, 'home');
    }
    const freshState = await resolveClientState(admin, telegramId, { memberRole });
    await showHomeHub(admin, freshState, chatId);
    return true;
  }

  if (data === 'cl:course:site') {
    await showOnlineCourseScreen(admin, state, chatId);
    return true;
  }

  if (data === 'cl:buy:course') {
    if (state.hasActiveCourse) {
      await beginStudentPurchase(admin, telegramId, chatId, { product: 'course' });
    } else {
      await showOnlineCourseScreen(admin, state, chatId);
    }
    return true;
  }

  if (data === 'cl:buy:individual') {
    await showBuyFormatHub(admin, telegramId, chatId, 'individual');
    return true;
  }

  if (data === 'cl:buy:group') {
    await showBuyFormatHub(admin, telegramId, chatId, 'group');
    return true;
  }

  if (data === 'cl:course:ask') {
    if (!state.hasActiveCourse) {
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: 'Раздел доступен после подключения онлайн-курса.',
        reply_markup: buildClientReplyKeyboard(state),
      });
      return true;
    }
    await beginStudentMentorQuestion(admin, telegramId, chatId, { context: 'course' });
    return true;
  }

  return false;
}

/** Неизвестный текст в клиентском UI — напоминание про меню. */
export async function handleClientUnknownText(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  memberRole?: BotRole,
): Promise<void> {
  const state = await resolveClientState(admin, telegramId, { memberRole });
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: 'Используйте кнопки меню под полем ввода.',
    reply_markup: buildClientReplyKeyboard(state),
  });
}
