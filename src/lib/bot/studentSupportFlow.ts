import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { getState, isConversationStateTableError, sendAdminMessage } from './admin/core';
import { logLeadEvent } from './admin/lead-events';
import { insertLeadMessage } from './admin/lead-messages';
import { setLeadStatus } from './admin/leads';
import { resetClientDialogToHub, saveClientDialogState, clientBackButton } from './client-nav';
import { isClientReplyLabel } from '@/lib/bot/client-menu';
import { createInquiryLead, type InquiryKind } from './inquiry-leads';
import { getMember } from './roles';

const SUPPORT_INTRO =
  '💬 Напишите ваше сообщение администрации.\n\n' +
  'Вы можете отправить текст, фото, документ или другое поддерживаемое сообщение.';

const SUPPORT_THREAD_HINT =
  'Можете отправить ещё сообщение по этому обращению или нажать «Отмена», чтобы выйти.';

function supportIntroKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '⬅️ Назад', callback_data: 'cl:support:back' }],
      [{ text: '❌ Отмена', callback_data: 'cl:support:cancel' }],
    ],
  };
}

async function inquiryKindForUser(admin: SupabaseClient, telegramId: number): Promise<InquiryKind> {
  const member = await getMember(admin, telegramId);
  if (member?.role === 'student') return 'student_question';
  return 'guest_question';
}

export async function beginStudentSupport(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
): Promise<void> {
  try {
    await saveClientDialogState(admin, telegramId, chatId, 'student:support', {});
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  await sendAdminMessage(chatId, SUPPORT_INTRO, supportIntroKeyboard());
}

export async function beginStudentSupportThreadFromLead(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  leadId: string,
): Promise<void> {
  try {
    await saveClientDialogState(admin, telegramId, chatId, 'student:support-thread', {
      inquiryLeadId: leadId,
    });
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  await sendAdminMessage(chatId, `✍️ Дополните обращение.\n\n${SUPPORT_THREAD_HINT}`, supportIntroKeyboard());
}

async function getAdminChatIds(admin: SupabaseClient): Promise<number[]> {
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
    const chatId = (row as { chat_id: number | null }).chat_id;
    if (typeof chatId === 'number') ids.add(chatId);
  }
  return [...ids];
}

async function memberLabel(admin: SupabaseClient, telegramId: number): Promise<string> {
  const [{ data: member }, { data: link }] = await Promise.all([
    admin.from('bot_members').select('full_name, phone').eq('telegram_id', telegramId).maybeSingle(),
    admin.from('telegram_links').select('phone').eq('telegram_id', telegramId).maybeSingle(),
  ]);
  const phone = link?.phone ?? member?.phone;
  const name = member?.full_name;
  if (name && phone) return `${name} · ${phone}`;
  if (name) return name;
  if (phone) return phone;
  return `ID ${telegramId}`;
}

export async function notifyAdminsOfSupportMessage(
  admin: SupabaseClient,
  studentTelegramId: number,
  text: string,
): Promise<void> {
  const adminChatIds = await getAdminChatIds(admin);
  if (adminChatIds.length === 0) return;

  const label = await memberLabel(admin, studentTelegramId);
  const body = ['🆘 Сообщение в поддержку', '', `👤 ${label}`, '', text].join('\n');

  await Promise.all(
    adminChatIds.map((chatId) =>
      telegramSend('sendMessage', { chat_id: chatId, text: body }).catch(() => undefined),
    ),
  );
}

async function enterSupportThread(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  leadId: string,
): Promise<void> {
  try {
    await saveClientDialogState(admin, telegramId, chatId, 'student:support-thread', {
      inquiryLeadId: leadId,
    });
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
}

async function appendInquiryMessage(
  admin: SupabaseClient,
  leadId: string,
  telegramId: number,
  body: string,
): Promise<void> {
  await insertLeadMessage(admin, {
    leadId,
    direction: 'client_to_admin',
    senderTelegramId: telegramId,
    body,
  });
  await logLeadEvent(admin, {
    leadId,
    eventType: 'client_message',
    actorTelegramId: telegramId,
    detail: { length: body.length },
  });
  await setLeadStatus(admin, leadId, 'awaiting_reply', null);
}

async function deliverSupportToAdmin(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  body: string,
  ack: string,
): Promise<void> {
  const kind = await inquiryKindForUser(admin, telegramId);
  const lead = await createInquiryLead(admin, telegramId, kind, body);
  await notifyAdminsOfSupportMessage(admin, telegramId, body);
  if (lead?.id) {
    await enterSupportThread(admin, telegramId, chatId, lead.id);
  }
  await sendAdminMessage(chatId, `${ack}\n\n${SUPPORT_THREAD_HINT}`, supportIntroKeyboard());
}

export async function handleStudentSupportMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  if (isClientReplyLabel(text)) return false;

  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }
  if (!state) return false;

  const trimmed = text.trim();
  if (!trimmed) return true;

  if (state.step === 'student:support-thread') {
    const leadId = state.payload?.inquiryLeadId as string | undefined;
    if (!leadId) return false;
    await appendInquiryMessage(admin, leadId, telegramId, trimmed);
    await notifyAdminsOfSupportMessage(admin, telegramId, trimmed);
    await sendAdminMessage(chatId, '✅ Сообщение добавлено к обращению.', supportIntroKeyboard());
    return true;
  }

  if (state.step !== 'student:support') return false;

  await deliverSupportToAdmin(
    admin,
    telegramId,
    chatId,
    trimmed,
    '✅ Сообщение отправлено администратору.\n\nМы ответим в Telegram или по контакту из профиля.',
  );
  return true;
}

export async function handleStudentSupportAttachment(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  caption: string,
): Promise<boolean> {
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }
  if (!state) return false;

  const body = caption || '(вложение без подписи)';

  if (state.step === 'student:support-thread') {
    const leadId = state.payload?.inquiryLeadId as string | undefined;
    if (!leadId) return false;
    await appendInquiryMessage(admin, leadId, telegramId, body);
    await notifyAdminsOfSupportMessage(admin, telegramId, body);
    await sendAdminMessage(chatId, '✅ Вложение добавлено к обращению.', supportIntroKeyboard());
    return true;
  }

  if (state.step !== 'student:support') return false;

  await deliverSupportToAdmin(
    admin,
    telegramId,
    chatId,
    body,
    '✅ Вложение отправлено администратору.',
  );
  return true;
}

export async function handleStudentSupportBack(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
): Promise<void> {
  await resetClientDialogToHub(admin, telegramId);
  await sendAdminMessage(chatId, 'Выберите раздел в меню ниже.', {
    inline_keyboard: [[clientBackButton()]],
  });
}

export async function handleStudentSupportCancel(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
): Promise<void> {
  await resetClientDialogToHub(admin, telegramId);
  await sendAdminMessage(chatId, 'Обращение отменено.');
}
