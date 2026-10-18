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
  showClientLessonHomeworkHub,
} from './client-lesson-homework-flow';
import {
  handleClientCourseHomeworkCallback,
  isClientCourseHomeworkCallback,
  showClientCourseHomeworkHub,
} from './client-course-homework-hub';
import { handleClientCourseHubCallback, isClientCourseHubCallback, showClientMyCourseHub } from './client-course-hub';
import {
  getCoursePaymentOfferBySlug,
  listCoursePaymentOffers,
} from '@/lib/studio/courseContent';
import { renderClientScreenById, type ClientScreenNavigateMode } from './client-screen-router';
import {
  handleClientSharedHubCallback,
  isClientSharedHubCallback,
  showClientContactHub,
  showClientMiscHub,
  showClientPaymentsHub,
} from './client-shared-hubs';
import { getClientProductMode, resolveClientState, type ClientStateSnapshot } from './client-state';
import {
  buildClientReplyKeyboard,
  buildClientWelcomeTextAsync,
  CLIENT_LABELS,
  isClientReplyLabel,
} from './client-menu';
import {
  clientBackButton,
  clientHomeButton,
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
    await pushClientCard(admin, telegramId, mode.chatId, screenId, text, keyboard, [
      'home',
      screenId,
    ]);
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

  const isGuestCatalog = state.phase === 'guest' || !state.hasActiveCourse;

  if (state.hasActiveCourse && state.phase !== 'guest') {
    const cabinetUrl = await createCabinetLoginUrl(admin, state.telegramId, '/cabinet?section=course');
    keyboard.inline_keyboard.push([{ text: '🌐 Открыть курс в кабинете', url: cabinetUrl }]);
    keyboard.inline_keyboard.push([{ text: '💬 Вопрос куратору по курсу', callback_data: 'cl:course:ask' }]);
  } else if (isGuestCatalog) {
    const offers = await listCoursePaymentOffers();
    lines.push('');
    if (offers.length === 0) {
      lines.push('Сейчас нет курсов, доступных для записи.');
    } else {
      lines.push('Доступные курсы:', '');
      for (const offer of offers) {
        lines.push(`📚 ${offer.title}`);
        lines.push(`${offer.priceByn} BYN · ${offer.grantedLessons} занятий`);
        if (offer.cardText?.trim()) lines.push(offer.cardText.trim());
        lines.push('');
      }
      for (const offer of offers) {
        keyboard.inline_keyboard.push([
          {
            text: `Подробнее · ${offer.title.slice(0, 40)}`,
            callback_data: `cl:guest:course:open:${offer.slug}`,
          },
        ]);
      }
    }
    keyboard.inline_keyboard.push([{ text: '📝 Оставить заявку на курс', callback_data: 'ca:start' }]);
    keyboard.inline_keyboard.push([{ text: '🌐 Перейти на сайт', url: courseInfoUrl() }]);
  } else {
    keyboard.inline_keyboard.push([{ text: '📝 Оставить заявку на курс', callback_data: 'ca:start' }]);
    keyboard.inline_keyboard.push([{ text: '🌐 Перейти на сайт', url: courseInfoUrl() }]);
  }
  keyboard.inline_keyboard.push([clientHomeButton()]);

  await applyCard(admin, state.telegramId, 'course', lines.join('\n').trim(), keyboard, mode);
}

async function showGuestCourseOfferScreen(
  admin: SupabaseClient,
  state: ClientStateSnapshot,
  slug: string,
  mode: CardMode,
): Promise<void> {
  const offer = await getCoursePaymentOfferBySlug(slug);
  if (!offer) {
    await showOnlineCourseScreen(admin, state, mode);
    return;
  }

  const lines = [
    `📚 ${offer.title}`,
    '',
    `${offer.priceByn} BYN · ${offer.grantedLessons} занятий`,
    offer.description?.trim() || null,
    offer.cardText?.trim() || null,
    '',
    'Оплата и доступ — в личном кабинете на сайте.',
  ].filter((x): x is string => Boolean(x));

  const cabinetUrl = await createCabinetLoginUrl(
    admin,
    state.telegramId,
    `/cabinet?section=course&course=${encodeURIComponent(offer.slug)}`,
  ).catch(() => null);

  const keyboardRows: Array<Array<Record<string, string>>> = [];
  if (cabinetUrl) {
    keyboardRows.push([{ text: '🛒 Купить на сайте', url: cabinetUrl }]);
  }
  keyboardRows.push([{ text: '📝 Оставить заявку на курс', callback_data: 'ca:start' }]);
  const allOffers = await listCoursePaymentOffers();
  if (allOffers.length > 1) {
    keyboardRows.push([{ text: '◀️ К списку курсов', callback_data: 'cl:guest:course:list' }]);
  }
  keyboardRows.push([clientHomeButton()]);

  await applyCard(
    admin,
    state.telegramId,
    'guest-course-detail',
    lines.join('\n'),
    { inline_keyboard: keyboardRows },
    mode,
  );
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
      [{ text: '👨‍🏫 Занятия с преподавателем', callback_data: 'cl:buy:lessons' }],
      [clientBackButton()],
    ],
  };
  await applyCard(admin, state.telegramId, 'buy-education', text, keyboard, mode);
}

async function showBuyCourseOffersScreen(
  admin: SupabaseClient,
  state: ClientStateSnapshot,
  mode: CardMode,
): Promise<void> {
  const offers = await listCoursePaymentOffers();
  const lines = [
    '🎓 Купить курс',
    '',
    'Оплата и выбор сценария — в личном кабинете на сайте.',
    '',
  ];
  const keyboardRows: Array<Array<Record<string, string>>> = [];
  if (offers.length === 0) {
    lines.push('Сейчас нет курсов, доступных для покупки в кабинете.');
  } else {
    for (const offer of offers) {
      lines.push(`📚 ${offer.title}`);
      lines.push(`${offer.priceByn} BYN · ${offer.grantedLessons} занятий`);
      if (offer.cardText?.trim()) lines.push(offer.cardText.trim());
      lines.push('');
      const url = await createCabinetLoginUrl(
        admin,
        state.telegramId,
        `/cabinet?section=course&course=${encodeURIComponent(offer.slug)}`,
      );
      keyboardRows.push([{ text: `🛒 Купить · ${offer.title.slice(0, 36)}`, url }]);
    }
  }
  keyboardRows.push([clientBackButton()]);
  await applyCard(admin, state.telegramId, 'buy-course-offers', lines.join('\n').trim(), {
    inline_keyboard: keyboardRows,
  }, mode);
}

async function showBuyLessonsFormatHub(
  admin: SupabaseClient,
  state: ClientStateSnapshot,
  mode: CardMode,
): Promise<void> {
  const text = ['👨‍🏫 Занятия с преподавателем', '', 'Выберите формат:'].join('\n');
  await applyCard(admin, state.telegramId, 'buy-lessons', text, {
    inline_keyboard: [
      [{ text: '📚 Индивидуальные', callback_data: 'cl:buy:individual' }],
      [{ text: '👥 Групповые', callback_data: 'cl:buy:group' }],
      [clientBackButton()],
    ],
  }, mode);
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

function screenRouterExtras(
  admin: SupabaseClient,
  telegramId: number,
  memberRole?: BotRole,
): Parameters<typeof renderClientScreenById>[6] {
  return {
    showBuyEducation: async (mode: ClientScreenNavigateMode) => {
      const state = await resolveClientState(admin, telegramId, { memberRole });
      await showBuyEducationHub(admin, state, mode as CardMode);
    },
    showBuyCourseOffers: async (mode: ClientScreenNavigateMode) => {
      const state = await resolveClientState(admin, telegramId, { memberRole });
      await showBuyCourseOffersScreen(admin, state, mode as CardMode);
    },
    showBuyLessons: async (mode: ClientScreenNavigateMode) => {
      const state = await resolveClientState(admin, telegramId, { memberRole });
      await showBuyLessonsFormatHub(admin, state, mode as CardMode);
    },
    showOnlineCourse: async (mode: ClientScreenNavigateMode) => {
      const state = await resolveClientState(admin, telegramId, { memberRole });
      await showOnlineCourseScreen(admin, state, mode as CardMode);
    },
    showLessonsHub: async (mode: ClientScreenNavigateMode) => {
      const state = await resolveClientState(admin, telegramId, { memberRole });
      await showLessonsHub(admin, state, mode as CardMode);
    },
    showLessonFormat: async (format, mode) => {
      await showLessonFormatScreen(admin, telegramId, format, mode as CardMode);
    },
  };
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
  const mode = { kind: 'edit' as const, hub, navStack: nextStack };
  await renderClientScreenById(
    admin,
    target,
    chatId,
    telegramId,
    memberRole,
    mode,
    screenRouterExtras(admin, telegramId, memberRole),
  );
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
  const { clearStateIfAvailable } = await import('./admin/core');
  await clearStateIfAvailable(admin, telegramId);
  await resetClientDialogToHub(admin, telegramId);
  const loaded = await loadClientHubPayload(admin, telegramId);
  const hub = loaded?.payload.clientHubChatId
    ? {
        chatId: loaded.payload.clientHubChatId,
        messageId: loaded.payload.clientHubMessageId ?? 0,
      }
    : { chatId, messageId: 0 };
  await saveClientHub(admin, telegramId, hub, 'home', {
    welcomeMessageId: loaded?.payload.welcomeMessageId,
    clientNavStack: ['home'],
  });
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
      if (state.phase === 'guest' || !state.hasActiveCourse) {
        await showOnlineCourseScreen(admin, state, { kind: 'push', chatId });
      } else {
        await showClientMyCourseHub(admin, telegramId, chatId, { forcePush: true });
      }
      return true;
    case CLIENT_LABELS.myCourse:
      await showClientMyCourseHub(admin, telegramId, chatId, { forcePush: true }, undefined);
      return true;
    case CLIENT_LABELS.homework: {
      const mode = getClientProductMode(state);
      if (mode === 'course') {
        await showClientCourseHomeworkHub(admin, telegramId, chatId, { forcePush: true });
      } else {
        await showClientLessonHomeworkHub(admin, telegramId, chatId, { forcePush: true });
      }
      return true;
    }
    case CLIENT_LABELS.contactTeacher:
      if (!state.hasActiveLessonProduct) {
        await telegramSend('sendMessage', {
          chat_id: chatId,
          text: 'Раздел доступен при активных занятиях с преподавателем.',
          reply_markup: buildClientReplyKeyboard(state),
        });
        return true;
      }
      await beginStudentMentorQuestion(admin, telegramId, chatId, { context: 'lessons' });
      return true;
    case CLIENT_LABELS.contactCurator:
      if (!state.hasActiveCourse) {
        await telegramSend('sendMessage', {
          chat_id: chatId,
          text: 'Раздел доступен после подключения онлайн-курса.',
          reply_markup: buildClientReplyKeyboard(state),
        });
        return true;
      }
      {
        const { openCuratorContactFlow } = await import('./client-curator-contact');
        await openCuratorContactFlow(admin, telegramId, chatId, { forcePush: true });
      }
      return true;
    case CLIENT_LABELS.contact:
      await showClientContactHub(admin, telegramId, chatId, { forcePush: true });
      return true;
    case CLIENT_LABELS.payments:
      await showClientPaymentsHub(admin, telegramId, chatId, { forcePush: true });
      return true;
    case CLIENT_LABELS.misc:
      await showClientMiscHub(admin, telegramId, chatId, { forcePush: true });
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
      await showClientApplicationsHub(admin, telegramId, chatId, { forcePush: true });
      return true;
    case CLIENT_LABELS.myLessons:
      await showClientLessonsMenu(admin, telegramId, chatId, state, { forcePush: true });
      return true;
    case CLIENT_LABELS.schedule:
      await showClientScheduleMenu(admin, telegramId, chatId, { forcePush: true });
      return true;
    case CLIENT_LABELS.myPackage:
      await showClientPackageMenu(admin, telegramId, chatId, { forcePush: true });
      return true;
    case CLIENT_LABELS.purchaseHistory:
      await showClientPurchaseHistory(admin, telegramId, chatId, { forcePush: true });
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

  if (data === 'cl:ntf:close') {
    if (callbackQueryId) {
      await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
    }
    try {
      await telegramSend('deleteMessage', { chat_id: chatId, message_id: messageId });
    } catch {
      /* message already gone */
    }
    return true;
  }

  const { isClientCuratorContactCallback, handleClientCuratorContactCallback } = await import(
    './client-curator-contact'
  );
  if (isClientCuratorContactCallback(data)) {
    return handleClientCuratorContactCallback(
      admin,
      data,
      chatId,
      messageId,
      telegramId,
      callbackQueryId,
    );
  }

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
    return handleClientMyLeadsCallback(admin, data, chatId, messageId, telegramId);
  }

  if (data === 'cl:buy:hub') {
    const state = await resolveClientState(admin, telegramId, { memberRole });
    await showBuyEducationHub(admin, state, {
      kind: 'edit',
      hub: { chatId, messageId },
      navStack: ['home', 'payments-hub', 'buy-education'],
    });
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

  if (isClientCourseHomeworkCallback(data)) {
    return handleClientCourseHomeworkCallback(admin, data, chatId, messageId, telegramId, callbackQueryId);
  }

  if (isClientCourseHubCallback(data)) {
    if (callbackQueryId) {
      await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
    }
    return handleClientCourseHubCallback(admin, data, chatId, messageId, telegramId);
  }

  if (isClientSharedHubCallback(data)) {
    return handleClientSharedHubCallback(admin, data, chatId, messageId, telegramId, callbackQueryId);
  }

  const known =
    data === 'cl:home' ||
    data === 'cl:back' ||
    data === 'cl:guest:course:list' ||
    data.startsWith('cl:guest:course:open:') ||
    data === 'cl:course:site' ||
    data === 'cl:buy:course' ||
    data === 'cl:buy:lessons' ||
    data === 'cl:buy:individual' ||
    data === 'cl:buy:group' ||
    data === 'cl:lessons:individual' ||
    data === 'cl:lessons:group' ||
    data === 'cl:course:ask' ||
    data.startsWith('cl:course:ask:');

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
  if (data === 'cl:home') {
    await resetClientDialogToHub(admin, telegramId);
    await saveClientHub(
      admin,
      telegramId,
      { chatId, messageId },
      'home',
      {
        welcomeMessageId: (await loadClientHubPayload(admin, telegramId))?.payload.welcomeMessageId,
        clientNavStack: ['home'],
      },
    );
    await editClientCard(
      admin,
      telegramId,
      { chatId, messageId },
      'home',
      'Выберите раздел в меню под полем ввода.',
      EMPTY_INLINE,
      ['home'],
    );
    return true;
  }

  if (data === 'cl:back') {
    await navigateClientBack(admin, telegramId, chatId, messageId, memberRole);
    return true;
  }

  if (data === 'cl:buy:course') {
    const loaded = await loadClientHubPayload(admin, telegramId);
    const stack = [...(loaded?.payload.clientNavStack ?? ['home', 'buy-education']), 'buy-course-offers'];
    await showBuyCourseOffersScreen(admin, state, {
      kind: 'edit',
      hub: { chatId, messageId },
      navStack: stack,
    });
    return true;
  }

  if (data === 'cl:course:site' || data === 'cl:guest:course:list') {
    await showOnlineCourseScreen(admin, state, {
      kind: 'edit',
      hub: { chatId, messageId },
      navStack: ['home', 'course'],
    });
    return true;
  }

  if (data.startsWith('cl:guest:course:open:')) {
    const slug = data.slice('cl:guest:course:open:'.length);
    const loaded = await loadClientHubPayload(admin, telegramId);
    const stack = [
      ...(loaded?.payload.clientNavStack ?? ['home', 'course']),
      'guest-course-detail',
    ];
    await showGuestCourseOfferScreen(admin, state, slug, {
      kind: 'edit',
      hub: { chatId, messageId },
      navStack: stack,
    });
    return true;
  }

  if (data === 'cl:buy:lessons') {
    const loaded = await loadClientHubPayload(admin, telegramId);
    const stack = [...(loaded?.payload.clientNavStack ?? ['home', 'buy-education']), 'buy-lessons'];
    await showBuyLessonsFormatHub(admin, state, {
      kind: 'edit',
      hub: { chatId, messageId },
      navStack: stack,
    });
    return true;
  }

  if (data === 'cl:lessons:individual' || data === 'cl:buy:individual') {
    const loaded = await loadClientHubPayload(admin, telegramId);
    const parent = data.startsWith('cl:buy:') ? 'buy-lessons' : 'lessons';
    const stack = [...(loaded?.payload.clientNavStack ?? ['home', parent]), 'lesson-individual'];
    await showLessonFormatScreen(admin, telegramId, 'individual', {
      kind: 'edit',
      hub: { chatId, messageId },
      navStack: stack,
    });
    return true;
  }

  if (data === 'cl:lessons:group' || data === 'cl:buy:group') {
    const loaded = await loadClientHubPayload(admin, telegramId);
    const parent = data.startsWith('cl:buy:') ? 'buy-lessons' : 'lessons';
    const stack = [...(loaded?.payload.clientNavStack ?? ['home', parent]), 'lesson-group'];
    await showLessonFormatScreen(admin, telegramId, 'group', {
      kind: 'edit',
      hub: { chatId, messageId },
      navStack: stack,
    });
    return true;
  }

  if (data === 'cl:course:ask' || data.startsWith('cl:course:ask:')) {
    if (!state.hasActiveCourse) {
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: 'Раздел доступен после подключения онлайн-курса.',
        reply_markup: buildClientReplyKeyboard(state),
      });
      return true;
    }
    const slug = data.startsWith('cl:course:ask:') ? data.slice('cl:course:ask:'.length) : undefined;
    await beginStudentMentorQuestion(admin, telegramId, chatId, {
      context: 'course',
      courseSlug: slug || undefined,
    });
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
