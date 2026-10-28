import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { insertStaffMessage, resolveMemberChatId, staffStudentLabel } from '@/lib/bot/staff/messaging';
import {
  deliverInboundToStaffTopic,
  listAdminTelegramIdsForTopics,
  staffDmTopicsEnabled,
} from '@/lib/bot/staff/dm-topics';
import { adminClientTopicCallback, notifyAdminClientContactPing } from './admin-dm-topic';

export type AdminInboxKind = 'support' | 'course_inquiry';

const PREFIX_REPLY = 'ah:gin:r:';
const PREFIX_CLOSE = 'ah:gin:x:';

export function isAdminGuestInboxCallback(data: string): boolean {
  return data.startsWith(PREFIX_REPLY) || data.startsWith(PREFIX_CLOSE);
}

export async function resolvePrimaryAdminTelegramId(
  admin: SupabaseClient,
): Promise<number | null> {
  const envFirst = (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  if (envFirst) {
    const id = Number(envFirst);
    if (Number.isFinite(id)) return id;
  }
  const ids = await listAdminTelegramIdsForTopics(admin);
  return ids[0] ?? null;
}

function topicContextIntro(
  kind: AdminInboxKind,
  label: string,
  body: string,
  courseTitle?: string,
): string {
  if (kind === 'course_inquiry') {
    const courseLine = courseTitle ? `«${courseTitle}»` : 'курсе';
    return [
      `📌 Диалог на тему: вопрос о ${courseLine}`,
      '',
      `👤 ${label}`,
      '',
      'Исходное сообщение:',
      body.trim() || '(без текста)',
      '',
      'Ответьте в этой теме — сообщение уйдёт собеседнику в боте.',
    ].join('\n');
  }
  return [
    '📌 Диалог по обращению в поддержку',
    '',
    `👤 ${label}`,
    '',
    'Исходное сообщение:',
    body.trim() || '(без текста)',
    '',
    'Ответьте в этой теме — сообщение уйдёт собеседнику в боте.',
  ].join('\n');
}

/** Гость/клиент: при Topics — сообщение в тему + короткий пинг с «Связаться»; иначе legacy inbox. */
export async function notifyPrimaryAdminMainChatInbox(
  admin: SupabaseClient,
  clientTelegramId: number,
  params: {
    kind: AdminInboxKind;
    header: string;
    body: string;
    courseTitle?: string;
    attachmentRef?: string | null;
    attachmentKind?: 'photo' | 'document' | 'voice' | null;
  },
): Promise<boolean> {
  const adminTelegramId = await resolvePrimaryAdminTelegramId(admin);
  if (!adminTelegramId) return false;

  const adminChatId = (await resolveMemberChatId(admin, adminTelegramId)) ?? adminTelegramId;
  const label = await staffStudentLabel(admin, clientTelegramId);

  if (staffDmTopicsEnabled()) {
    const intro = topicContextIntro(params.kind, label, params.body, params.courseTitle);
    const delivered = await deliverInboundToStaffTopic(admin, {
      staffTelegramId: adminTelegramId,
      staffRole: 'admin',
      studentTelegramId: clientTelegramId,
      body: params.body,
      attachmentRef: params.attachmentRef,
      attachmentKind: params.attachmentKind,
      contextIntro: intro,
      plain: true,
    });
    if (!delivered) return false;
    return notifyAdminClientContactPing(admin, adminChatId, clientTelegramId, {
      header: params.header,
      preview: params.body,
      courseTitle: params.courseTitle,
    });
  }

  const messageId = await insertStaffMessage(admin, {
    staffTelegramId: adminTelegramId,
    studentTelegramId: clientTelegramId,
    staffRole: 'admin',
    direction: 'student_to_staff',
    body: params.body.trim() || '(вложение)',
    attachmentRef: params.attachmentRef,
    attachmentKind: params.attachmentKind,
  });

  const lines = [params.header, '', `👤 ${label}`, '', params.body.trim() || '(вложение)'];
  if (params.courseTitle) {
    lines.splice(2, 0, `📚 ${params.courseTitle}`);
  }

  const replyCb =
    messageId != null
      ? `${PREFIX_REPLY}${clientTelegramId}:${messageId}:${params.kind}`
      : `${PREFIX_REPLY}${clientTelegramId}:0:${params.kind}`;
  const closeCb = messageId != null ? `${PREFIX_CLOSE}${messageId}` : 'noop';

  const sent = await telegramSend('sendMessage', {
    chat_id: adminChatId,
    text: lines.join('\n'),
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💬 Связаться', callback_data: adminClientTopicCallback(clientTelegramId) },
          { text: '✅ Закрыть', callback_data: closeCb },
        ],
      ],
    },
  });
  if (!sent.ok) return false;

  const ref = params.attachmentRef?.trim() ?? '';
  const fileId = ref.startsWith('tg:') ? ref.slice(3) : null;
  if (fileId && params.attachmentKind) {
    const { sendTelegramFileById } = await import('@/lib/bot/studentHomeworkFlow');
    await sendTelegramFileById(adminChatId, fileId, params.attachmentKind);
  }

  return true;
}

async function loadInboxStaffMessage(
  admin: SupabaseClient,
  staffMessageId: number,
  clientTelegramId: number,
): Promise<{ body: string; courseTitle?: string } | null> {
  const { data, error } = await admin
    .from('staff_student_messages')
    .select('body, student_telegram_id')
    .eq('id', staffMessageId)
    .maybeSingle();
  if (error) return null;
  if (!data || (data as { student_telegram_id: number }).student_telegram_id !== clientTelegramId) {
    return null;
  }
  return { body: String((data as { body?: string }).body ?? '') };
}

export async function handleAdminGuestInboxCallback(
  admin: SupabaseClient,
  data: string,
  adminTelegramId: number,
  chatId: number,
  messageId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (data.startsWith(PREFIX_CLOSE)) {
    const id = Number(data.slice(PREFIX_CLOSE.length));
    if (Number.isFinite(id) && id > 0) {
      await admin
        .from('staff_student_messages')
        .update({ staff_read_at: new Date().toISOString() })
        .eq('id', id)
        .eq('direction', 'student_to_staff');
    }
    try {
      await telegramSend('deleteMessage', { chat_id: chatId, message_id: messageId });
    } catch {
      /* already gone */
    }
    return true;
  }

  if (!data.startsWith(PREFIX_REPLY)) return false;

  const rest = data.slice(PREFIX_REPLY.length);
  const parts = rest.split(':');
  const clientTelegramId = Number(parts[0]);
  const staffMsgId = Number(parts[1]);
  const kind = (parts[2] === 'course_inquiry' ? 'course_inquiry' : 'support') as AdminInboxKind;

  if (!Number.isFinite(clientTelegramId)) return true;

  if (!staffDmTopicsEnabled()) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'Topics отключены (STAFF_DM_TOPICS_ENABLED).',
    });
    return true;
  }

  let body = '';
  if (Number.isFinite(staffMsgId) && staffMsgId > 0) {
    const row = await loadInboxStaffMessage(admin, staffMsgId, clientTelegramId);
    body = row?.body ?? '';
  }

  const courseTitle =
    kind === 'course_inquiry'
      ? (await import('@/lib/bot/guest-course-inquiry-flow')).parseCourseTitleFromInquiryBody(body)
      : undefined;

  const label = await staffStudentLabel(admin, clientTelegramId);
  const intro = topicContextIntro(kind, label, body, courseTitle);

  const { openStaffDmTopicAndNavigate } = await import('@/lib/bot/staff/staff-dm-topic-navigate');
  const opened = await openStaffDmTopicAndNavigate(admin, {
    staffTelegramId: adminTelegramId,
    studentTelegramId: clientTelegramId,
    staffRole: 'admin',
    introText: intro,
    callbackQueryId,
    notifyChatId: chatId,
  });

  if (!opened.ok) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: `❌ ${opened.error ?? 'Не удалось открыть тему.'}`,
    });
    return true;
  }

  if (Number.isFinite(staffMsgId) && staffMsgId > 0) {
    await admin
      .from('staff_student_messages')
      .update({ staff_read_at: new Date().toISOString() })
      .eq('id', staffMsgId);
  }

  try {
    await telegramSend('deleteMessage', { chat_id: chatId, message_id: messageId });
  } catch {
    /* optional */
  }
  return true;
}
