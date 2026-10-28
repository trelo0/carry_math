import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { getPublicSiteUrl } from '@/lib/siteUrl';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import { BOT_COPY_KEYS, getBotCopy } from '@/lib/bot/bot-copy';
import {
  beginStudentSupport,
  handleStudentSupportBack,
  handleStudentSupportCancel,
} from './studentSupportFlow';
import { showClientPurchaseHistory } from './client-purchase-history';
import {
  CLIENT_LESSONS_BOT_DISABLED_TEXT,
  CLIENT_LESSONS_BOT_UI_ENABLED,
} from './client-lessons-ui-flag';
import {
  handleClientCourseHomeworkCallback,
  isClientCourseHomeworkCallback,
  showClientCourseHomeworkHub,
  showClientHomeworkMenu,
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
  showClientMiscHub,
  showClientPaymentsHub,
} from './client-shared-hubs';
import { resolveClientState, type ClientStateSnapshot } from './client-state';
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
    keyboard.inline_keyboard.push([{ text: '💬 Связаться по курсу', callback_data: 'cl:course:ask' }]);
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
  } else {
    keyboard.inline_keyboard.push([{ text: '📝 Оставить заявку на курс', callback_data: 'ca:start' }]);
    keyboard.inline_keyboard.push([{ text: '🌐 Перейти на сайт', url: courseInfoUrl() }]);
  }
  keyboard.inline_keyboard.push([clientHomeButton()]);

  await applyCard(admin, state.telegramId, 'course', lines.join('\n').trim(), keyboard, mode);
}

export async function showGuestCourseOfferScreen(
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
  keyboardRows.push([
    {
      text: '📖 Узнать больше о курсе',
      callback_data: `cl:guest:course:ask:${offer.slug}`,
    },
  ]);
  keyboardRows.push([{ text: '🌐 Перейти на сайт', url: courseInfoUrl() }]);
  keyboardRows.push([{ text: '◀️ Назад', callback_data: 'cl:guest:course:list' }]);
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
    showBuyCourseOffers: async (mode: ClientScreenNavigateMode) => {
      const state = await resolveClientState(admin, telegramId, { memberRole });
      await showBuyCourseOffersScreen(admin, state, mode as CardMode);
    },
    showOnlineCourse: async (mode: ClientScreenNavigateMode) => {
      const state = await resolveClientState(admin, telegramId, { memberRole });
      await showOnlineCourseScreen(admin, state, mode as CardMode);
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
    case CLIENT_LABELS.homework:
      await showClientHomeworkMenu(admin, telegramId, chatId, { forcePush: true });
      return true;
    case CLIENT_LABELS.contactTeacher:
    case CLIENT_LABELS.lessonsWithTeacher:
    case CLIENT_LABELS.buy:
    case CLIENT_LABELS.leaveRequest:
    case CLIENT_LABELS.myLessons:
    case CLIENT_LABELS.schedule:
    case CLIENT_LABELS.myPackage:
    case CLIENT_LABELS.contact:
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: CLIENT_LESSONS_BOT_UI_ENABLED
          ? 'Раздел занятий с преподавателем. Обновите меню /menu.'
          : CLIENT_LESSONS_BOT_DISABLED_TEXT,
        reply_markup: buildClientReplyKeyboard(state),
      });
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
        const { showStudentAppealsRoot } = await import('./client-appeals-hub');
        await showStudentAppealsRoot(admin, telegramId, chatId, { forcePush: true });
      }
      return true;
    case CLIENT_LABELS.payments:
      await showClientPaymentsHub(admin, telegramId, chatId, { forcePush: true });
      return true;
    case CLIENT_LABELS.misc:
      await showClientMiscHub(admin, telegramId, chatId, { forcePush: true });
      return true;
    case CLIENT_LABELS.contactAdmin:
      await beginStudentSupport(admin, telegramId, chatId);
      return true;
    case CLIENT_LABELS.buyEducation:
    case CLIENT_LABELS.buyCourse:
      await showBuyCourseOffersScreen(admin, state, { kind: 'push', chatId });
      return true;
    case CLIENT_LABELS.myApplications:
      await showClientApplicationsHub(admin, telegramId, chatId, { forcePush: true });
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

  if (data.startsWith('cl:msg:show:')) {
    if (callbackQueryId) {
      await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
    }
    const staffMsgId = Number(data.slice('cl:msg:show:'.length));
    if (!Number.isFinite(staffMsgId)) return true;
    const { loadStaffMessageForStudent } = await import('./staff/messaging');
    const { sendTelegramFileById } = await import('./studentHomeworkFlow');
    const row = await loadStaffMessageForStudent(admin, telegramId, staffMsgId);
    if (!row) {
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: 'Сообщение не найдено или устарело.',
      });
      return true;
    }
    const roleLabel =
      row.staffRole === 'teacher'
        ? 'преподавателя'
        : row.staffRole === 'admin'
          ? 'администрации'
          : row.staffRole === 'check'
            ? 'проверяющего ДЗ'
            : 'куратора курса';
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: `💬 Сообщение от ${roleLabel}:\n\n${row.body}`,
    });
    const ref = row.attachmentRef?.trim() ?? '';
    if (ref.startsWith('tg:')) {
      await sendTelegramFileById(chatId, ref.slice(3), row.attachmentKind);
    }
    try {
      await telegramSend('deleteMessage', { chat_id: chatId, message_id: messageId });
    } catch {
      /* notification already removed */
    }
    return true;
  }

  const { isClientAppealsCallback, handleClientAppealsCallback } = await import(
    './client-appeals-hub'
  );
  if (isClientAppealsCallback(data)) {
    return handleClientAppealsCallback(
      admin,
      data,
      chatId,
      messageId,
      telegramId,
      callbackQueryId,
    );
  }

  if (data === 'cl:staff-dm:cancel') {
    if (callbackQueryId) {
      await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
    }
    const { handleStudentStaffDmCancel } = await import('./student-staff-dm-thread');
    await handleStudentStaffDmCancel(admin, telegramId);
    await resetClientDialogToHub(admin, telegramId);
    return true;
  }

  if (data === 'cl:support:back' || data === 'cl:support:cancel') {
    if (callbackQueryId) {
      await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
    }
    if (data === 'cl:support:back') {
      await handleStudentSupportBack(admin, telegramId, chatId);
    } else {
      await handleStudentSupportCancel(admin, telegramId, chatId, memberRole, messageId);
    }
    return true;
  }

  if (isClientMyLeadsCallback(data)) {
    return handleClientMyLeadsCallback(admin, data, chatId, messageId, telegramId);
  }

  if (data === 'cl:buy:hub') {
    const state = await resolveClientState(admin, telegramId, { memberRole });
    await showBuyCourseOffersScreen(admin, state, {
      kind: 'edit',
      hub: { chatId, messageId },
      navStack: ['home', 'payments-hub', 'buy-course-offers'],
    });
    return true;
  }

  if (CLIENT_LESSONS_BOT_UI_ENABLED) {
    const { isClientLeadCallback, handleClientLeadCallback } = await import('./client-lead-flow');
    if (isClientLeadCallback(data)) {
      return handleClientLeadCallback(admin, data, chatId, messageId, telegramId, callbackQueryId);
    }
    const { isClientLessonsCallback, handleClientLessonsCallback } = await import(
      './client-lessons-flow'
    );
    if (isClientLessonsCallback(data)) {
      return handleClientLessonsCallback(admin, data, chatId, messageId, telegramId, callbackQueryId);
    }
    const { isClientLessonHomeworkCallback, handleClientLessonHomeworkCallback } = await import(
      './client-lesson-homework-flow'
    );
    if (isClientLessonHomeworkCallback(data)) {
      return handleClientLessonHomeworkCallback(
        admin,
        data,
        chatId,
        messageId,
        telegramId,
        callbackQueryId,
      );
    }
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

  if (
    data.startsWith('cl:guest:course:ask') ||
    data === 'cl:guest:course:ask:cancel' ||
    data === 'cl:guest:course:ask:send' ||
    data === 'cl:guest:course:ask:edit'
  ) {
    const { handleGuestCourseInquiryCallback } = await import('./guest-course-inquiry-flow');
    return handleGuestCourseInquiryCallback(admin, data, telegramId, chatId, callbackQueryId);
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
