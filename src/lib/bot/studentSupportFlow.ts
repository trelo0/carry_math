import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  clearStateIfAvailable,
  getState,
  isConversationStateTableError,
  sendAdminMessage,
} from './admin/core';
import { logLeadEvent } from './admin/lead-events';
import { insertLeadMessage } from './admin/lead-messages';
import { setLeadStatus } from './admin/leads';
import {
  restoreClientHubAfterDialogCancel,
  resetClientDialogToHub,
  saveClientDialogState,
  clientBackButton,
} from './client-nav';
import type { BotRole } from './roles';
import { isClientReplyLabel } from '@/lib/bot/client-menu';
import { createInquiryLead, type InquiryKind } from './inquiry-leads';
import { getMember } from './roles';
import { studentNotifyKeyboard } from './student-push-notify';
import { resolvePrimaryAdminTelegramId } from './admin/admin-guest-inbox';
import {
  deliverStudentPlainToStaffTopic,
  saveStudentStaffDmState,
  STUDENT_STAFF_DM_STEP,
} from './student-staff-dm-thread';
import { staffDmTopicsEnabled } from './staff/dm-topics';

const SUPPORT_INTRO =
  '❓ ЗАДАЙТЕ СВОЙ ВОПРОС\n\n' +
  'Администратор свяжется с вами.\n\n' +
  'Напишите сообщение ниже — текст, фото или документ.';

const SUPPORT_THREAD_HINT =
  'Можете отправить ещё сообщение по этому обращению или нажать «Отмена», чтобы выйти.';

function supportIntroKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '◀️ Назад', callback_data: 'cl:support:back' }],
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
  attachment?: { ref: string; kind: 'photo' | 'document' | 'voice' },
  topicDelivery?: { contextIntro?: string; plain?: boolean; skipTopic?: boolean },
): Promise<void> {
  const member = await getMember(admin, studentTelegramId);
  if (member?.role === 'student' && staffDmTopicsEnabled()) {
    const adminId = await resolvePrimaryAdminTelegramId(admin);
    if (adminId) {
      await deliverStudentPlainToStaffTopic(
        admin,
        studentTelegramId,
        { staffTelegramId: adminId, staffRole: 'admin' },
        text,
        attachment,
        { contextIntro: topicDelivery?.contextIntro, plain: topicDelivery?.plain ?? true },
      );
      return;
    }
  }

  const { notifyPrimaryAdminMainChatInbox } = await import('@/lib/bot/admin/admin-guest-inbox');
  const label = await memberLabel(admin, studentTelegramId);
  const body = ['🆘 Сообщение в поддержку', '', `👤 ${label}`, '', text].join('\n');

  const inboxSent = await notifyPrimaryAdminMainChatInbox(admin, studentTelegramId, {
    kind: 'support',
    header: '🆘 Сообщение в поддержку',
    body: text,
    attachmentRef: attachment?.ref,
    attachmentKind: attachment?.kind,
  });
  if (inboxSent) return;

  const adminChatIds = await getAdminChatIds(admin);
  if (adminChatIds.length === 0) return;

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
  attachment?: {
    fileId: string;
    kind: 'photo' | 'document' | 'voice';
    fileName?: string;
    mimeType?: string;
  },
): Promise<void> {
  await insertLeadMessage(admin, {
    leadId,
    direction: 'client_to_admin',
    senderTelegramId: telegramId,
    body: body || null,
    messageType: attachment?.kind ?? 'text',
    attachment: attachment
      ? {
          file_id: attachment.fileId,
          kind: attachment.kind,
          file_name: attachment.fileName,
          mime_type: attachment.mimeType,
        }
      : undefined,
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
  attachment?: {
    fileId: string;
    kind: 'photo' | 'document' | 'voice';
    fileName?: string;
    mimeType?: string;
  },
): Promise<void> {
  const kind = await inquiryKindForUser(admin, telegramId);
  const lead = await createInquiryLead(admin, telegramId, kind, body, {
    forceNew: true,
    firstAttachment: attachment,
  });
  const isStudent = kind === 'student_question';
  await notifyAdminsOfSupportMessage(
    admin,
    telegramId,
    body,
    attachment ? { ref: `tg:${attachment.fileId}`, kind: attachment.kind } : undefined,
    isStudent
      ? {
          contextIntro: '🆘 Обращение в поддержку\n\nОтветьте в этой теме — ученик получит ответ в боте.',
          plain: true,
        }
      : undefined,
  );
  const adminId = isStudent ? await resolvePrimaryAdminTelegramId(admin) : null;
  if (isStudent && adminId && staffDmTopicsEnabled()) {
    await saveStudentStaffDmState(admin, telegramId, chatId, {
      staffTelegramId: adminId,
      staffRole: 'admin',
      inquiryLeadId: lead?.id,
    });
    await sendAdminMessage(chatId, `${ack}\n\n${SUPPORT_THREAD_HINT}`, {
      inline_keyboard: [
        [{ text: '❌ Отмена', callback_data: 'cl:staff-dm:cancel' }],
        ...studentNotifyKeyboard().inline_keyboard,
      ],
    });
    return;
  }
  if (lead?.id) {
    await enterSupportThread(admin, telegramId, chatId, lead.id);
  }
  await sendAdminMessage(chatId, `${ack}\n\n${SUPPORT_THREAD_HINT}`, {
    inline_keyboard: [
      ...supportIntroKeyboard().inline_keyboard,
      ...studentNotifyKeyboard().inline_keyboard,
    ],
  });
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
    await notifyAdminsOfSupportMessage(admin, telegramId, trimmed, undefined, { plain: true });
    await sendAdminMessage(chatId, '✅ Сообщение добавлено к обращению.', supportIntroKeyboard());
    return true;
  }

  if (state.step === STUDENT_STAFF_DM_STEP) return false;

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
  media?: {
    fileId: string;
    kind: 'photo' | 'document' | 'voice';
    fileName?: string;
    mimeType?: string;
  },
): Promise<boolean> {
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }
  if (!state) return false;

  const body = caption.trim();

  if (state.step === 'student:support-thread') {
    const leadId = state.payload?.inquiryLeadId as string | undefined;
    if (!leadId) return false;
    await appendInquiryMessage(admin, leadId, telegramId, body, media);
    await notifyAdminsOfSupportMessage(
      admin,
      telegramId,
      body,
      media ? { ref: `tg:${media.fileId}`, kind: media.kind } : undefined,
      { plain: true },
    );
    await sendAdminMessage(chatId, '✅ Вложение добавлено к обращению.', supportIntroKeyboard());
    return true;
  }

  if (state.step === STUDENT_STAFF_DM_STEP) return false;

  if (state.step !== 'student:support') return false;

  await deliverSupportToAdmin(
    admin,
    telegramId,
    chatId,
    body,
    '✅ Вложение отправлено администратору.',
    media,
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
  _memberRole?: BotRole,
  promptMessageId?: number,
): Promise<void> {
  await clearStateIfAvailable(admin, telegramId);
  if (promptMessageId) {
    await telegramSend('deleteMessage', { chat_id: chatId, message_id: promptMessageId }).catch(
      () => undefined,
    );
  }
}
