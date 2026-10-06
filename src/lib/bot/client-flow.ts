import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { getPublicSiteUrl } from '@/lib/siteUrl';
import { getCabinetPricing } from '@/lib/studio/cabinetSettings';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import { BOT_COPY_KEYS, getBotCopy } from '@/lib/bot/bot-copy';
import { beginStudentPurchase } from './studentPurchaseFlow';
import {
  beginStudentSupport,
  handleStudentSupportBack,
  handleStudentSupportCancel,
} from './studentSupportFlow';
import { handleClientLeadCallback, isClientLeadCallback } from './client-lead-flow';
import {
  handleClientLessonsCallback,
  isClientLessonsCallback,
  showClientLessonsMenu,
  showClientPackageMenu,
  showClientScheduleMenu,
} from './client-lessons-flow';
import { showClientPurchaseHistory } from './client-purchase-history';
import {
  handleClientLessonHomeworkCallback,
  isClientLessonHomeworkCallback,
} from './client-lesson-homework-flow';
import { resolveClientState, type ClientStateSnapshot } from './client-state';
import {
  buildClientReplyKeyboard,
  buildClientWelcomeTextAsync,
  CLIENT_LABELS,
  isClientReplyLabel,
} from './client-menu';
import {
  clientBackButton,
  editClientCard,
  loadClientHubPayload,
  popNavStack,
  pushClientCard,
  resetClientDialogToHub,
  saveClientHub,
  type ClientHubState,
} from './client-nav';
import type { BotRole } from './roles';
import { beginStudentMentorQuestion } from './studentMentorFlow';
import { handleClientMyLeadsCallback, isClientMyLeadsCallback, showClientApplicationsHub } from './client-my-leads';

const EMPTY_INLINE = { inline_keyboard: [] as Array<Array<Record<string, string>>> };

type CardMode =
  | { kind: 'push'; chatId: number }
  | { kind: 'edit'; hub: ClientHubState; navStack?: string[] };

function courseInfoUrl(): string {
  return process.env.NEXT_PUBLIC_BOT_COURSE_INFO_URL?.trim() || getPublicSiteUrl();
}

async function formatTeacherList(): Promise<string> {
  const pricing = await getCabinetPricing();
  const names = pricing.teachers.map((t) => t.name.trim()).filter(Boolean);
  if (names.length === 0) {
    return 'Преподаватели: команда District — уточним при заявке.';
  }
  const lines = names.slice(0, 12).map((name) => `• ${name}`);
  const more = names.length > 12 ? `\n… и ещё ${names.length - 12}` : '';
  return `Преподаватели:\n${lines.join('\n')}${more}`;
}

async function applyCard(
  admin: SupabaseClient,
  telegramId: number,
  screenId: string,
  text: string,
  keyboard: { inline_keyboard: Array<Array<Record<string, string>>> },
  mode: CardMode,
): Promise<void> {
  if (mode.kind === 'push') {
    await pushClientCard(admin, telegramId, mode.chatId, screenId, text, keyboard);
    return;
  }
  await editClientCard(admin, telegramId, mode.hub, screenId, text, keyboard, mode.navStack);
}

async function showOnlineCourseScreen(
  admin: SupabaseClient,
  state: ClientStateSnapshot,
  mode: CardMode,
): Promise<void> {
  const lines = (await getBotCopy(BOT_COPY_KEYS.guestCourseScreen)).split('\n');

  const keyboard: { inline_keyboard: Array<Array<Record<string, string>>> } = {
    inline_keyboard: [],
  };

  if (state.hasActiveCourse) {
    const cabinetUrl = await createCabinetLoginUrl(admin, state.telegramId, '/cabinet?section=course');
    keyboard.inline_keyboard.push([{ text: '🌐 Открыть курс в кабинете', url: cabinetUrl }]);
    keyboard.inline_keyboard.push([{ text: '💬 Вопрос куратору по курсу', callback_data: 'cl:course:ask' }]);
  } else {
    keyboard.inline_keyboard.push([{ text: '🌐 Перейти на сайт', url: courseInfoUrl() }]);
  }
  keyboard.inline_keyboard.push([clientBackButton()]);

  await applyCard(admin, state.telegramId, 'course', lines.join('\n'), keyboard, mode);
}

async function showBuyEducationHub(
  admin: SupabaseClient,
  state: ClientStateSnapshot,
  mode: CardMode,
): Promise<void> {
  const text = ['🎓 Купить обучение', '', 'Выберите формат:'].join('\n');
  const keyboard = {
    inline_keyboard: [
      [{ text: '📚 Купить курс', callback_data: 'cl:buy:course' }],
      [{ text: '👨‍🏫 Занятия с преподавателем', callback_data: 'cl:lessons:individual' }],
      [clientBackButton()],
    ],
  };
  await applyCard(admin, state.telegramId, 'buy-education', text, keyboard, mode);
}

async function showLessonsHub(
  admin: SupabaseClient,
  state: ClientStateSnapshot,
  mode: CardMode,
): Promise<void> {
  const text = await getBotCopy(BOT_COPY_KEYS.guestLessonsHub);
  const keyboard = {
    inline_keyboard: [
      [{ text: '📚 Индивидуальные', callback_data: 'cl:lessons:individual' }],
      [{ text: '👥 Групповые', callback_data: 'cl:lessons:group' }],
      [clientBackButton()],
    ],
  };
  await applyCard(admin, state.telegramId, 'lessons', text, keyboard, mode);
}

async function showLessonFormatScreen(
  admin: SupabaseClient,
  telegramId: number,
  format: 'individual' | 'group',
  mode: CardMode,
): Promise<void> {
  const teachersBlock = await formatTeacherList();
  const title = format === 'individual' ? 'Индивидуальные занятия' : 'Групповые занятия';
  const body =
    format === 'individual'
      ? await getBotCopy(BOT_COPY_KEYS.guestLessonsIndividualBody)
      : await getBotCopy(BOT_COPY_KEYS.guestLessonsGroupBody);
  const screenId = format === 'individual' ? 'lesson-individual' : 'lesson-group';
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
  await applyCard(admin, telegramId, screenId, text, keyboard, mode);
}

async function renderClientScreen(
  admin: SupabaseClient,
  screenId: string,
  chatId: number,
  telegramId: number,
  memberRole: BotRole | undefined,
  mode: CardMode,
): Promise<void> {
  const state = await resolveClientState(admin, telegramId, { memberRole });
  switch (screenId) {
    case 'course':
      await showOnlineCourseScreen(admin, state, mode);
      break;
    case 'lessons':
      await showLessonsHub(admin, state, mode);
      break;
    case 'lesson-individual':
      await showLessonFormatScreen(admin, telegramId, 'individual', mode);
      break;
    case 'lesson-group':
      await showLessonFormatScreen(admin, telegramId, 'group', mode);
      break;
    case 'home':
    default:
      if (mode.kind === 'edit') {
        await editClientCard(
          admin,
          telegramId,
          mode.hub,
          'home',
          'Выберите раздел в меню под полем ввода.',
          EMPTY_INLINE,
          mode.navStack,
        );
      }
      break;
  }
}

async function navigateClientBack(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  messageId: number,
  memberRole?: BotRole,
): Promise<void> {
  const loaded = await loadClientHubPayload(admin, telegramId);
  const stack = loaded?.payload.clientNavStack ?? ['home'];
  const { target, nextStack } = popNavStack(stack);
  const hub = { chatId, messageId };
  await renderClientScreen(admin, target, chatId, telegramId, memberRole, {
    kind: 'edit',
    hub,
    navStack: nextStack,
  });
  await saveClientHub(admin, telegramId, hub, target, {
    welcomeMessageId: loaded?.payload.welcomeMessageId,
    clientNavStack: nextStack,
  });
}

/** /start и /menu для клиентского UI (guest/student). */
export async function sendClientStart(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  options?: { testFooter?: string; memberRole?: BotRole },
): Promise<void> {
  const state = await resolveClientState(admin, telegramId, { memberRole: options?.memberRole });
  const welcome = await buildClientWelcomeTextAsync(state, options?.testFooter ?? '');
  const replyMarkup = buildClientReplyKeyboard(state);

  const result = await telegramSend('sendMessage', {
    chat_id: chatId,
    text: welcome,
    reply_markup: replyMarkup,
  });
  const welcomeMessageId = result.result?.message_id;
  if (welcomeMessageId) {
    await saveClientHub(
      admin,
      telegramId,
      { chatId, messageId: 0 },
      'home',
      {
        welcomeMessageId,
        clientNavStack: ['home'],
        clientHubChatId: chatId,
      },
    );
  }
}

export async function refreshClientMenu(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  memberRole?: BotRole,
): Promise<void> {
  await sendClientStart(admin, telegramId, chatId, { memberRole });
}

/** Нижнее меню: сброс заявки/поддержки и переход в раздел. */
export async function handleClientReplyMenuNavigation(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
  memberRole?: BotRole,
): Promise<boolean> {
  if (!isClientReplyLabel(text)) return false;
  await resetClientDialogToHub(admin, telegramId);
  return handleClientMessage(admin, telegramId, chatId, text, memberRole);
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
      await showOnlineCourseScreen(admin, state, { kind: 'push', chatId });
      return true;
    case CLIENT_LABELS.lessonsWithTeacher:
    case CLIENT_LABELS.buy:
    case CLIENT_LABELS.leaveRequest:
      await showLessonsHub(admin, state, { kind: 'push', chatId });
      return true;
    case CLIENT_LABELS.contactAdmin:
      await beginStudentSupport(admin, telegramId, chatId);
      return true;
    case CLIENT_LABELS.buyEducation:
      await showBuyEducationHub(admin, state, { kind: 'push', chatId });
      return true;
    case CLIENT_LABELS.myApplications:
      await showClientApplicationsHub(admin, telegramId, chatId);
      return true;
    case CLIENT_LABELS.myLessons:
      await showClientLessonsMenu(admin, telegramId, chatId, state);
      return true;
    case CLIENT_LABELS.schedule:
      await showClientScheduleMenu(admin, telegramId, chatId);
      return true;
    case CLIENT_LABELS.myPackage:
      await showClientPackageMenu(admin, telegramId, chatId);
      return true;
    case CLIENT_LABELS.purchaseHistory:
      await showClientPurchaseHistory(admin, telegramId, chatId);
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

  if (data === 'cl:support:back' || data === 'cl:support:cancel') {
    if (callbackQueryId) {
      await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
    }
    if (data === 'cl:support:back') {
      await handleStudentSupportBack(admin, telegramId, chatId);
    } else {
      await handleStudentSupportCancel(admin, telegramId, chatId);
    }
    return true;
  }

  if (isClientMyLeadsCallback(data)) {
    return handleClientMyLeadsCallback(admin, data, chatId, telegramId);
  }

  if (data === 'cl:buy:hub') {
    const state = await resolveClientState(admin, telegramId, { memberRole });
    await showBuyEducationHub(admin, state, { kind: 'push', chatId });
    return true;
  }

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
    data === 'cl:lessons:individual' ||
    data === 'cl:lessons:group' ||
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
    await navigateClientBack(admin, telegramId, chatId, messageId, memberRole);
    return true;
  }

  if (data === 'cl:course:site' || data === 'cl:buy:course') {
    if (data === 'cl:buy:course' && state.hasActiveCourse) {
      await beginStudentPurchase(admin, telegramId, chatId, { product: 'course' });
      return true;
    }
    const loaded = await loadClientHubPayload(admin, telegramId);
    const stack = [...(loaded?.payload.clientNavStack ?? ['home']), 'course'];
    await showOnlineCourseScreen(admin, state, {
      kind: 'edit',
      hub: { chatId, messageId },
      navStack: stack,
    });
    return true;
  }

  if (data === 'cl:lessons:individual' || data === 'cl:buy:individual') {
    const loaded = await loadClientHubPayload(admin, telegramId);
    const stack = [...(loaded?.payload.clientNavStack ?? ['home', 'lessons']), 'lesson-individual'];
    await showLessonFormatScreen(admin, telegramId, 'individual', {
      kind: 'edit',
      hub: { chatId, messageId },
      navStack: stack,
    });
    return true;
  }

  if (data === 'cl:lessons:group' || data === 'cl:buy:group') {
    const loaded = await loadClientHubPayload(admin, telegramId);
    const stack = [...(loaded?.payload.clientNavStack ?? ['home', 'lessons']), 'lesson-group'];
    await showLessonFormatScreen(admin, telegramId, 'group', {
      kind: 'edit',
      hub: { chatId, messageId },
      navStack: stack,
    });
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
