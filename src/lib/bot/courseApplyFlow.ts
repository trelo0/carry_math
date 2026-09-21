import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { maskPhone } from '@/lib/phone';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import { getCabinetPricing } from '@/lib/studio/cabinetSettings';
import { resolveDefaultCuratorTelegramId } from '@/lib/bot/teacher-mapping';
import { getMember, setRole } from '@/lib/bot/roles';
import { linkTelegramToPhone } from '@/lib/bot/telegram-account-link';
import {
  clearStateIfAvailable,
  getState,
  isConversationStateTableError,
  saveState,
  sendAdminMessage,
} from '@/lib/bot/admin/core';
import {
  createPurchaseRequest,
  findPendingPurchaseRequest,
  isPurchaseRequestTableError,
  type PurchaseRequestRow,
} from '@/lib/bot/purchase-requests';

export const COURSE_APPLY_LINK_STEP = 'course-apply:link-phone' as const;

async function isTelegramLinked(admin: SupabaseClient, telegramId: number): Promise<boolean> {
  const { data } = await admin
    .from('telegram_links')
    .select('phone')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  return Boolean(data?.phone);
}

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

async function collectStaffChatIds(admin: SupabaseClient): Promise<number[]> {
  const envIds = (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const roleFilter = envIds.length
    ? `role.eq.admin,role.eq.curator,role.eq.mentor,telegram_id.in.(${envIds.join(',')})`
    : 'role.eq.admin,role.eq.curator,role.eq.mentor';

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

  const curatorId = await resolveDefaultCuratorTelegramId(admin);
  if (curatorId) {
    const { data: curator } = await admin
      .from('bot_members')
      .select('chat_id')
      .eq('telegram_id', curatorId)
      .maybeSingle();
    const chatId = curator?.chat_id as number | undefined;
    if (chatId) ids.add(chatId);
  }

  return [...ids];
}

async function notifyStaffCourseApplication(
  admin: SupabaseClient,
  request: PurchaseRequestRow,
): Promise<void> {
  const label = await memberLabel(admin, request.telegram_id);
  const text = [
    '🔔 Новая заявка на курс District',
    '',
    `👤 ${label}`,
    `📝 ${request.title}`,
    `💳 ${request.amount_byn} BYN`,
    '',
    'Откройте раздел «Заявки на оплату» в админ-боте.',
  ].join('\n');

  const chatIds = await collectStaffChatIds(admin);
  for (const chatId of chatIds) {
    const result = await telegramSend('sendMessage', { chat_id: chatId, text });
    if (!result.ok) {
      console.error('[courseApply] staff notify failed:', result.description);
    }
  }
}

type SubmitResult = 'created' | 'already_pending';

async function submitCourseApplication(
  admin: SupabaseClient,
  telegramId: number,
): Promise<SubmitResult> {
  const existing = await findPendingPurchaseRequest(admin, telegramId, 'course', 0, null);
  if (existing) return 'already_pending';

  const pricing = await getCabinetPricing().catch(() => null);
  const amountByn = pricing?.course?.offer?.priceByn ?? 0;

  const request = await createPurchaseRequest(admin, {
    telegramId,
    product: 'course',
    packageIndex: 0,
    title: 'Заявка на запись на курс District',
    amountByn,
  });

  const member = await getMember(admin, telegramId);
  if (member?.role === 'guest') {
    await setRole(admin, telegramId, 'student');
  }

  await notifyStaffCourseApplication(admin, request);
  return 'created';
}

async function sendApplicationSuccess(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  phone: string,
  submitResult: SubmitResult,
  linkedJustNow: boolean,
): Promise<void> {
  const cabinetUrl = await createCabinetLoginUrl(admin, telegramId, '/cabinet?section=course');
  const lines = [];

  if (linkedJustNow) {
    lines.push(`✅ Telegram привязан к номеру ${maskPhone(phone)}.`);
  }

  if (submitResult === 'created') {
    lines.push('✅ Заявка на запись на курс оформлена.');
    lines.push('');
    lines.push('Дождитесь ответа куратора — мы свяжемся с вами в ближайшее время.');
  } else {
    lines.push('✅ Заявка на запись на курс уже была отправлена ранее.');
    lines.push('');
    lines.push('Дождитесь ответа куратора.');
  }

  lines.push('');
  lines.push('🌐 Личный кабинет уже доступен — откройте по ссылке ниже.');

  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: lines.join('\n'),
    reply_markup: { remove_keyboard: true },
  });
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: '👇 Вход в кабинет без пароля — по ссылке:',
    reply_markup: {
      inline_keyboard: [[{ text: '🌐 Открыть личный кабинет', url: cabinetUrl }]],
    },
  });
}

export async function promptCourseApplyPhoneLink(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
): Promise<void> {
  try {
    await saveState(admin, telegramId, { chatId, messageId: 0 }, COURSE_APPLY_LINK_STEP, {});
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

async function finishLinkAndApply(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  phone: string,
  fullName?: string,
): Promise<void> {
  const linkResult = await linkTelegramToPhone(admin, telegramId, phone, { fullName });
  if (!linkResult.ok) {
    await sendAdminMessage(chatId, linkResult.error);
    return;
  }

  await clearStateIfAvailable(admin, telegramId);

  try {
    const submitResult = await submitCourseApplication(admin, telegramId);
    await sendApplicationSuccess(
      admin,
      telegramId,
      chatId,
      linkResult.phone,
      submitResult,
      linkResult.created,
    );
  } catch (error) {
    if (isPurchaseRequestTableError(error)) {
      await sendAdminMessage(
        chatId,
        '✅ Telegram привязан, но заявки временно недоступны. Попробуйте позже или напишите в поддержку.',
      );
      return;
    }
    throw error;
  }
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

  if (!state || state.step !== COURSE_APPLY_LINK_STEP) return false;

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

  const { data: link } = await admin
    .from('telegram_links')
    .select('phone')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (!link?.phone) return;

  await clearStateIfAvailable(admin, telegramId);
  try {
    const submitResult = await submitCourseApplication(admin, telegramId);
    await sendApplicationSuccess(admin, telegramId, chatId, link.phone as string, submitResult, true);
  } catch (error) {
    if (isPurchaseRequestTableError(error)) return;
    throw error;
  }
}

/** Deep link /start course_apply — заявка на курс с главной страницы. */
export async function beginCourseApplication(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
): Promise<void> {
  const linked = await isTelegramLinked(admin, telegramId);
  if (!linked) {
    await promptCourseApplyPhoneLink(admin, telegramId, chatId);
    return;
  }

  try {
    const submitResult = await submitCourseApplication(admin, telegramId);
    const { data: link } = await admin
      .from('telegram_links')
      .select('phone')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    await sendApplicationSuccess(
      admin,
      telegramId,
      chatId,
      (link?.phone as string) ?? '',
      submitResult,
      false,
    );
  } catch (error) {
    if (isPurchaseRequestTableError(error)) {
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: '⚠️ Заявки временно недоступны. Напишите нам в поддержку или попробуйте позже.',
      });
      return;
    }
    throw error;
  }
}
