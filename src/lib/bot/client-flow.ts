import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { SITE_URL_FALLBACK } from '@/lib/siteUrl';
import { listMentorPickerCandidates } from '@/lib/bot/admin/staff-roster';
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
  clientBackButton,
  editHubMessage,
  loadClientHub,
  resetClientDialogToHub,
  saveClientHub,
  sendHubMessage,
} from './client-nav';
import { getState } from './admin/core';
import type { ClientHubPayload } from './client-nav';
import type { BotRole } from './roles';
import { beginStudentMentorQuestion } from './studentMentorFlow';

const EMPTY_INLINE = { inline_keyboard: [] as Array<Array<Record<string, string>>> };

function publicSiteUrl(path = ''): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || SITE_URL_FALLBACK).replace(/\/$/, '');
  return path ? `${base}${path.startsWith('/') ? path : `/${path}`}` : base;
}

function courseInfoUrl(): string {
  return process.env.NEXT_PUBLIC_BOT_COURSE_INFO_URL?.trim() || publicSiteUrl('/');
}

async function formatTeacherList(admin: SupabaseClient): Promise<string> {
  const teachers = await listMentorPickerCandidates(admin, 'teacher');
  if (teachers.length === 0) {
    return 'Преподаватели: команда District — уточним при заявке.';
  }
  const lines = teachers.slice(0, 8).map((t) => `• ${t.full_name?.trim() || `ID ${t.telegram_id}`}`);
  const more = teachers.length > 8 ? `\n… и ещё ${teachers.length - 8}` : '';
  return `Преподаватели:\n${lines.join('\n')}${more}`;
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
    'Системная подготовка к ЦТ/ЦЭ по математике: вебинары, практика, домашние задания и поддержка куратора.',
    '',
    'Подходит, если нужен понятный маршрут к экзамену без хаоса в материалах.',
    '',
    'Оплата и доступ — на сайте школы; после покупки занятия и материалы открываются в личном кабинете.',
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
  keyboard.inline_keyboard.push([clientBackButton()]);

  await showHubScreen(admin, state.telegramId, chatId, 'course', lines.join('\n'), keyboard);
}

async function showBuyHub(
  admin: SupabaseClient,
  state: ClientStateSnapshot,
  chatId: number,
): Promise<void> {
  const text =
    '💳 Купить обучение\n\n' +
    '🎓 Онлайн-курс — оплатить на сайте и сразу получить доступ в кабинете.\n\n' +
    '📚 Индивидуальные и 👥 групповые занятия — выберите формат: мы расскажем условия и поможем оформить заявку на подключение.';
  const keyboard = {
    inline_keyboard: [
      [{ text: '🎓 Онлайн-курс', callback_data: 'cl:buy:course' }],
      [{ text: '📚 Индивидуальные занятия', callback_data: 'cl:buy:individual' }],
      [{ text: '👥 Групповые занятия', callback_data: 'cl:buy:group' }],
      [clientBackButton()],
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
  const teachersBlock = await formatTeacherList(admin);
  const title = format === 'individual' ? 'Индивидуальные занятия' : 'Групповые занятия';
  const body =
    format === 'individual'
      ? 'Занятия один на один с преподавателем: разбор тем, домашние задания, гибкое расписание под ученика.'
      : 'Небольшая группа с общим темпом: занятия с преподавателем, практика и поддержка куратора.';
  const text = [`📚 ${title}`, '', body, '', teachersBlock, '', 'Оставьте заявку — администратор согласует расписание и стоимость.'].join(
    '\n',
  );
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '📝 Оставить заявку',
          callback_data: format === 'individual' ? 'cl:lead:fmt:individual' : 'cl:lead:fmt:group',
        },
      ],
      [clientBackButton()],
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
  const text = buildClientWelcomeText(state, testFooter);
  await showHubScreen(admin, state.telegramId, chatId, 'home', text, EMPTY_INLINE);
}

async function navigateClientBack(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  memberRole?: BotRole,
): Promise<void> {
  let screen = 'home';
  try {
    const state = await getState(admin, telegramId);
    screen = (state?.payload as ClientHubPayload | undefined)?.clientScreen ?? 'home';
  } catch {
    /* ignore */
  }
  const clientState = await resolveClientState(admin, telegramId, { memberRole });
  if (screen === 'buy-individual' || screen === 'buy-group') {
    await showBuyHub(admin, clientState, chatId);
    return;
  }
  if (screen === 'buy' || screen === 'course' || screen === 'lead-format') {
    await showHomeHub(admin, clientState, chatId);
    return;
  }
  await showHomeHub(admin, clientState, chatId);
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

  const result = await telegramSend('sendMessage', {
    chat_id: chatId,
    text: welcome,
    reply_markup: replyMarkup,
  });
  const messageId = result.result?.message_id;
  if (messageId) {
    await saveClientHub(admin, telegramId, { chatId, messageId }, 'home');
  }
}

/** Обновить Reply-меню после покупки, привязки и т.д. */
export async function refreshClientMenu(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  memberRole?: BotRole,
): Promise<void> {
  const state = await resolveClientState(admin, telegramId, { memberRole });
  const welcome = buildClientWelcomeText(state);
  const result = await telegramSend('sendMessage', {
    chat_id: chatId,
    text: welcome,
    reply_markup: buildClientReplyKeyboard(state),
  });
  const messageId = result.result?.message_id;
  if (messageId) {
    await saveClientHub(admin, telegramId, { chatId, messageId }, 'home');
  }
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
    await navigateClientBack(admin, telegramId, chatId, memberRole);
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
