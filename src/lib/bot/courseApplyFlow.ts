import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { maskPhone } from '@/lib/phone';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import { getCabinetPricing } from '@/lib/studio/cabinetSettings';
import { getMember, setRole } from '@/lib/bot/roles';
import { linkTelegramToPhone } from '@/lib/bot/telegram-account-link';
import {
  clearStateIfAvailable,
  getState,
  isConversationStateTableError,
  saveState,
  sendAdminMessage,
  type AdminPayload,
} from '@/lib/bot/admin/core';
import { resolveClientState } from '@/lib/bot/client-state';
import {
  createPurchaseRequest,
  findPendingPurchaseRequest,
  isPurchaseRequestTableError,
  type PurchaseRequestRow,
} from '@/lib/bot/purchase-requests';

export const COURSE_APPLY_LINK_STEP = 'course-apply:link-phone' as const;
export const COURSE_APPLY_FORM_STEP = 'course-apply:form' as const;

type CourseApplyFormStep = 'name' | 'wishes' | 'contact' | 'confirm';

export type CourseApplyFormPayload = AdminPayload & {
  courseApplyStep?: CourseApplyFormStep;
  courseApplyName?: string;
  courseApplyWishes?: string;
  courseApplyContact?: string;
  courseApplyFormMessageId?: number;
};

type CourseApplyDetails = {
  name?: string;
  wishes?: string;
  contact?: string;
};

async function memberLabel(admin: SupabaseClient, telegramId: number): Promise<string> {
  const member = await getMember(admin, telegramId);
  const { data: link } = await admin
    .from('telegram_links')
    .select('phone')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  const phone = link?.phone ?? member?.phone ?? null;
  const name = member?.full_name ?? null;
  if (name && phone) return `${name} · ${phone}`;
  if (name) return name;
  if (phone) return phone;
  return `ID ${telegramId}`;
}

/** Только админы (role=admin или ADMIN_TELEGRAM_IDS) — не кураторы/преподы. */
async function collectAdminChatIds(admin: SupabaseClient): Promise<number[]> {
  const envIds = (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const roleFilter = envIds.length
    ? `role.eq.admin,telegram_id.in.(${envIds.join(',')})`
    : 'role.eq.admin';

  const { data, error } = await admin
    .from('bot_members')
    .select('chat_id, telegram_id')
    .or(roleFilter)
    .not('chat_id', 'is', null);
  if (error) throw error;

  const ids = new Set<number>();
  for (const row of data ?? []) {
    const chatId = row.chat_id as number | null;
    if (typeof chatId === 'number') ids.add(chatId);
  }
  return [...ids];
}

async function notifyAdminsCourseApplication(
  admin: SupabaseClient,
  request: PurchaseRequestRow,
  details?: CourseApplyDetails,
): Promise<void> {
  const label = await memberLabel(admin, request.telegram_id);
  const text = [
    '🔔 Новая заявка на курс District',
    '',
    `👤 ${label}`,
    details?.name ? `📝 Имя: ${details.name}` : null,
    details?.wishes ? `💬 Пожелания: ${details.wishes}` : null,
    details?.contact ? `📞 Контакт: ${details.contact}` : null,
    `📋 ${request.title}`,
    `💳 ${request.amount_byn} BYN`,
    '',
    'Откройте раздел «Заявки на оплату» в админ-боте.',
  ]
    .filter(Boolean)
    .join('\n');

  const chatIds = await collectAdminChatIds(admin);
  for (const chatId of chatIds) {
    const result = await telegramSend('sendMessage', { chat_id: chatId, text });
    if (!result.ok) {
      console.error('[courseApply] admin notify failed:', result.description);
    }
  }
}

type SubmitResult = 'created' | 'already_pending';

function detailsFromPayload(payload?: CourseApplyFormPayload): CourseApplyDetails {
  return {
    name: payload?.courseApplyName?.trim() || undefined,
    wishes: payload?.courseApplyWishes?.trim() || undefined,
    contact: payload?.courseApplyContact?.trim() || undefined,
  };
}

async function submitCourseApplication(
  admin: SupabaseClient,
  telegramId: number,
  details?: CourseApplyDetails,
): Promise<SubmitResult> {
  const existing = await findPendingPurchaseRequest(admin, telegramId, 'course', 0, null);
  if (existing) return 'already_pending';

  const pricing = await getCabinetPricing().catch(() => null);
  const amountByn = pricing?.course?.offer?.priceByn ?? 0;
  const namePart = details?.name?.trim();
  const titleParts = ['Заявка на запись на курс District'];
  if (namePart) titleParts.push(namePart);

  const request = await createPurchaseRequest(admin, {
    telegramId,
    product: 'course',
    packageIndex: 0,
    title: titleParts.join(' · '),
    amountByn,
  });

  const member = await getMember(admin, telegramId);
  if (member?.role === 'guest') {
    await setRole(admin, telegramId, 'student');
  }
  if (namePart && (!member?.full_name || member.full_name.trim() === '')) {
    await admin.from('bot_members').update({ full_name: namePart }).eq('telegram_id', telegramId);
  }

  await notifyAdminsCourseApplication(admin, request, details);
  return 'created';
}

async function sendApplicationSuccess(
  chatId: number,
  submitResult: SubmitResult,
  linkedJustNow: boolean,
  phone?: string,
): Promise<void> {
  const lines: string[] = [];

  if (linkedJustNow && phone) {
    lines.push(`✅ Telegram привязан к номеру ${maskPhone(phone)}.`);
  }

  if (submitResult === 'created') {
    lines.push('✅ Заявка на курс отправлена. Куратор свяжется с вами в ближайшее время.');
  } else {
    lines.push('✅ Заявка на курс уже была отправлена ранее. Куратор свяжется с вами.');
  }

  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: lines.join('\n'),
    reply_markup: { remove_keyboard: true },
  });
}

async function clearInlineKeyboard(chatId: number, messageId: number | undefined): Promise<void> {
  if (!messageId) return;
  await telegramSend('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  }).catch(() => undefined);
}

function formSteps(): CourseApplyFormStep[] {
  return ['name', 'wishes', 'contact', 'confirm'];
}

function previousFormStep(step: CourseApplyFormStep): CourseApplyFormStep | null {
  const order = formSteps();
  const i = order.indexOf(step);
  if (i <= 0) return null;
  return order[i - 1] ?? null;
}

function nextFormStep(step: Exclude<CourseApplyFormStep, 'confirm'>): CourseApplyFormStep {
  if (step === 'name') return 'wishes';
  if (step === 'wishes') return 'contact';
  return 'confirm';
}

function stepPrompt(step: Exclude<CourseApplyFormStep, 'confirm'>): string {
  if (step === 'name') return 'Шаг 1 из 3 — Введите имя:';
  if (step === 'wishes') {
    return 'Шаг 2 из 3 — Пожелания к курсу (необязательно).\nНапишите текст или нажмите «Пропустить».';
  }
  return 'Шаг 3 из 3 — Контакт для связи (телефон / @username, необязательно).\nНапишите или нажмите «Пропустить».';
}

function confirmSummary(payload: CourseApplyFormPayload): string {
  return [
    '📝 Проверьте заявку на курс District',
    '',
    `Имя: ${payload.courseApplyName ?? '—'}`,
    `Пожелания: ${payload.courseApplyWishes?.trim() || '—'}`,
    `Контакт: ${payload.courseApplyContact?.trim() || '—'}`,
    '',
    'После отправки куратор свяжется с вами.',
  ].join('\n');
}

async function persistFormState(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  payload: CourseApplyFormPayload,
  step: CourseApplyFormStep,
): Promise<void> {
  try {
    await saveState(
      admin,
      telegramId,
      { chatId, messageId: payload.courseApplyFormMessageId ?? 0 },
      COURSE_APPLY_FORM_STEP,
      { ...payload, courseApplyStep: step },
    );
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
}

async function pushFormStep(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  payload: CourseApplyFormPayload,
  step: CourseApplyFormStep,
  options?: { retireMessageId?: number },
): Promise<void> {
  await clearInlineKeyboard(chatId, options?.retireMessageId ?? payload.courseApplyFormMessageId);

  const text = step === 'confirm' ? confirmSummary(payload) : stepPrompt(step);
  const canSkip = step === 'wishes' || step === 'contact';
  const keyboard =
    step === 'confirm'
      ? {
          inline_keyboard: [
            [{ text: '✅ Отправить заявку', callback_data: 'ca:submit' }],
            [{ text: '✏️ Изменить с начала', callback_data: 'ca:edit' }],
            [{ text: '❌ Отменить', callback_data: 'ca:cancel' }],
          ],
        }
      : {
          inline_keyboard: [
            ...(canSkip ? [[{ text: '⏭ Пропустить', callback_data: 'ca:skip' }]] : []),
            ...(previousFormStep(step)
              ? [[{ text: '◀️ На шаг назад', callback_data: 'ca:back' }]]
              : []),
            [{ text: '❌ Отменить', callback_data: 'ca:cancel' }],
          ],
        };

  const result = await telegramSend('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: keyboard,
  });
  payload.courseApplyFormMessageId = result.result?.message_id;
  await persistFormState(admin, telegramId, chatId, payload, step);
}

async function startApplicationForm(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  options?: { retireMessageId?: number },
): Promise<void> {
  const payload: CourseApplyFormPayload = {};
  await pushFormStep(admin, telegramId, chatId, payload, 'name', options);
}

export async function promptCourseApplyPhoneLink(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  formPayload?: CourseApplyFormPayload,
): Promise<void> {
  try {
    await saveState(admin, telegramId, { chatId, messageId: 0 }, COURSE_APPLY_LINK_STEP, {
      ...(formPayload ?? {}),
    });
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  await telegramSend('sendMessage', {
    chat_id: chatId,
    text:
      '📋 Запись на курс District\n\n' +
      'Чтобы оформить заявку, привяжите номер телефона — он нужен для личного кабинета на сайте.\n\n' +
      'Нажмите кнопку ниже или отправьте номер текстом (+375…).\n\n' +
      'Отмена — напишите «Отмена».',
    reply_markup: {
      keyboard: [[{ text: '📱 Отправить номер телефона', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

async function finishSubmitAfterLink(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  phone: string,
  linkedJustNow: boolean,
  formPayload?: CourseApplyFormPayload,
): Promise<void> {
  await clearStateIfAvailable(admin, telegramId);

  try {
    const submitResult = await submitCourseApplication(admin, telegramId, detailsFromPayload(formPayload));
    await sendApplicationSuccess(chatId, submitResult, linkedJustNow, phone);
  } catch (error) {
    if (isPurchaseRequestTableError(error)) {
      await sendAdminMessage(
        chatId,
        linkedJustNow
          ? '✅ Telegram привязан, но заявки временно недоступны. Попробуйте позже или напишите в поддержку.'
          : '⚠️ Заявки временно недоступны. Напишите нам в поддержку или попробуйте позже.',
      );
      return;
    }
    throw error;
  }
}

async function finishLinkAndApply(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  phone: string,
  fullName?: string,
): Promise<void> {
  let formPayload: CourseApplyFormPayload | undefined;
  try {
    const state = await getState(admin, telegramId);
    if (state?.step === COURSE_APPLY_LINK_STEP) {
      formPayload = state.payload as CourseApplyFormPayload;
    }
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  const linkResult = await linkTelegramToPhone(admin, telegramId, phone, { fullName });
  if (!linkResult.ok) {
    await sendAdminMessage(chatId, linkResult.error);
    return;
  }

  await finishSubmitAfterLink(
    admin,
    telegramId,
    chatId,
    linkResult.phone,
    linkResult.created,
    formPayload,
  );
}

async function submitCourseForm(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  payload: CourseApplyFormPayload,
): Promise<void> {
  await clearStateIfAvailable(admin, telegramId);

  try {
    const submitResult = await submitCourseApplication(admin, telegramId, detailsFromPayload(payload));
    await sendApplicationSuccess(chatId, submitResult, false);
  } catch (error) {
    if (isPurchaseRequestTableError(error)) {
      await sendAdminMessage(
        chatId,
        '⚠️ Заявки временно недоступны. Напишите нам в поддержку или попробуйте позже.',
      );
      return;
    }
    throw error;
  }
}

export function isCourseApplyCallback(data: string): boolean {
  return data.startsWith('ca:');
}

export async function handleCourseApplyCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!isCourseApplyCallback(data)) return false;

  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }

  if (data === 'ca:start') {
    const client = await resolveClientState(admin, telegramId);
    if (client.hasActiveCourse) {
      await clearInlineKeyboard(chatId, messageId);
      const cabinetUrl = await createCabinetLoginUrl(admin, telegramId, '/cabinet?section=course');
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: 'Вы уже подключены к онлайн-курсу District. Откройте кабинет или напишите куратору, если нужна помощь.',
        reply_markup: {
          inline_keyboard: [[{ text: '🌐 Открыть курс в кабинете', url: cabinetUrl }]],
        },
      });
      return true;
    }
    await startApplicationForm(admin, telegramId, chatId, { retireMessageId: messageId });
    return true;
  }

  if (data === 'ca:cancel') {
    await clearInlineKeyboard(chatId, messageId);
    await clearStateIfAvailable(admin, telegramId);
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'Заявка на курс отменена. Если передумаете — снова нажмите «Оставить заявку» на сайте или в меню курса.',
      reply_markup: { remove_keyboard: true },
    });
    return true;
  }

  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return true;
  }
  if (!state || state.step !== COURSE_APPLY_FORM_STEP) return true;

  const payload = state.payload as CourseApplyFormPayload;
  const step = payload.courseApplyStep ?? 'name';

  if (data === 'ca:back') {
    const prev = previousFormStep(step === 'confirm' ? 'contact' : step);
    await pushFormStep(admin, telegramId, chatId, payload, prev ?? 'name', {
      retireMessageId: messageId,
    });
    return true;
  }

  if (data === 'ca:skip') {
    if (step === 'wishes') {
      await pushFormStep(
        admin,
        telegramId,
        chatId,
        { ...payload, courseApplyWishes: undefined },
        'contact',
        { retireMessageId: messageId },
      );
      return true;
    }
    if (step === 'contact') {
      await pushFormStep(
        admin,
        telegramId,
        chatId,
        { ...payload, courseApplyContact: undefined },
        'confirm',
        { retireMessageId: messageId },
      );
      return true;
    }
    return true;
  }

  if (data === 'ca:edit') {
    await pushFormStep(admin, telegramId, chatId, {}, 'name', { retireMessageId: messageId });
    return true;
  }

  if (data === 'ca:submit') {
    await clearInlineKeyboard(chatId, messageId);
    await submitCourseForm(admin, telegramId, chatId, payload);
    return true;
  }

  return true;
}

export async function handleCourseApplyPhoneMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }

  if (!state) return false;

  if (state.step === COURSE_APPLY_FORM_STEP) {
    const payload = state.payload as CourseApplyFormPayload;
    const step = payload.courseApplyStep ?? 'name';
    const trimmed = text.trim();

    if (trimmed.toLowerCase() === 'отмена') {
      await clearStateIfAvailable(admin, telegramId);
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: 'Заявка на курс отменена.',
        reply_markup: { remove_keyboard: true },
      });
      return true;
    }

    if (step === 'name') {
      if (trimmed.length < 2) {
        await sendAdminMessage(chatId, 'Введите имя — минимум 2 символа.');
        return true;
      }
      await pushFormStep(
        admin,
        telegramId,
        chatId,
        { ...payload, courseApplyName: trimmed },
        nextFormStep('name'),
        { retireMessageId: payload.courseApplyFormMessageId },
      );
      return true;
    }

    if (step === 'wishes') {
      const skip = /^(пропустить|-|нет)$/i.test(trimmed);
      await pushFormStep(
        admin,
        telegramId,
        chatId,
        { ...payload, courseApplyWishes: skip ? undefined : trimmed },
        nextFormStep('wishes'),
        { retireMessageId: payload.courseApplyFormMessageId },
      );
      return true;
    }

    if (step === 'contact') {
      const skip = /^(пропустить|-|нет)$/i.test(trimmed);
      await pushFormStep(
        admin,
        telegramId,
        chatId,
        { ...payload, courseApplyContact: skip ? undefined : trimmed },
        nextFormStep('contact'),
        { retireMessageId: payload.courseApplyFormMessageId },
      );
      return true;
    }

    return true;
  }

  if (state.step !== COURSE_APPLY_LINK_STEP) return false;

  if (text.trim().toLowerCase() === 'отмена') {
    await clearStateIfAvailable(admin, telegramId);
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'Запись на курс отменена.',
      reply_markup: { remove_keyboard: true },
    });
    return true;
  }

  await finishLinkAndApply(admin, telegramId, chatId, text.trim());
  return true;
}

export async function handleCourseApplyContact(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  contact: { phone_number?: string; user_id?: number; first_name?: string; last_name?: string },
): Promise<boolean> {
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }

  if (!state || state.step !== COURSE_APPLY_LINK_STEP) return false;

  if (contact.user_id != null && contact.user_id !== telegramId) {
    await sendAdminMessage(chatId, 'Отправьте свой контакт, а не чужой номер.');
    return true;
  }

  const phone = contact.phone_number;
  if (!phone) {
    await sendAdminMessage(chatId, 'В контакте нет номера. Отправьте номер текстом (+375…).');
    return true;
  }

  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || undefined;
  await finishLinkAndApply(admin, telegramId, chatId, phone, fullName);
  return true;
}

/** После привязки через токен с сайта — если ждали course_apply, оформить заявку. */
export async function tryCompleteCourseApplyAfterExternalLink(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
): Promise<void> {
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return;
  }
  if (!state || state.step !== COURSE_APPLY_LINK_STEP) return;

  const formPayload = state.payload as CourseApplyFormPayload;
  const { data: link } = await admin
    .from('telegram_links')
    .select('phone')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (!link?.phone) return;

  await finishSubmitAfterLink(admin, telegramId, chatId, link.phone as string, true, formPayload);
}

/** Deep link /start course_apply — intro + кнопка заявки (гость / студент без курса). */
export async function beginCourseApplication(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
): Promise<void> {
  const client = await resolveClientState(admin, telegramId);

  if (client.hasActiveCourse) {
    const cabinetUrl = await createCabinetLoginUrl(admin, telegramId, '/cabinet?section=course');
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text:
        'Вы уже на курсе District 🎓\n\n' +
        'Откройте личный кабинет или напишите куратору, если нужна помощь.',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🌐 Открыть курс в кабинете', url: cabinetUrl }],
          [{ text: '💬 Вопрос куратору', callback_data: 'cl:course:ask' }],
        ],
      },
    });
    return;
  }

  const pending = await findPendingPurchaseRequest(admin, telegramId, 'course', 0, null).catch(
    (error) => {
      if (isPurchaseRequestTableError(error)) return null;
      throw error;
    },
  );
  if (pending) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: '✅ Заявка на курс уже отправлена. Куратор свяжется с вами.',
    });
    return;
  }

  await startApplicationForm(admin, telegramId, chatId);
}
