import type { SupabaseClient } from '@supabase/supabase-js';
import { loadMemberRoles, memberHasRole, isAdminEnv } from '@/lib/bot/roles';
import {
  deliverStaffTopicReplyToStudent,
  resolveStaffDmTopicByThread,
  staffDmTopicsEnabled,
} from './dm-topics';

export type TopicInboundMessage = {
  message_id?: number;
  from?: { id: number; is_bot?: boolean };
  chat?: { id: number; type?: string };
  text?: string;
  caption?: string;
  is_topic_message?: boolean;
  message_thread_id?: number;
  photo?: Array<{ file_id?: string }>;
  document?: { file_id?: string };
  voice?: { file_id?: string };
};

function formatTelegramFileRef(fileId: string): string {
  return `tg:${fileId}`;
}

export async function handleStaffDmTopicInboundMessage(
  admin: SupabaseClient,
  message: TopicInboundMessage,
): Promise<boolean> {
  if (!staffDmTopicsEnabled()) return false;
  if (!message.is_topic_message || message.message_thread_id == null) return false;
  if (message.from?.is_bot) return false;
  const staffTelegramId = message.from?.id;
  if (!staffTelegramId) return false;

  const roles = await loadMemberRoles(admin, staffTelegramId);
  const isCheck = memberHasRole(roles, 'check');
  const isCurator = memberHasRole(roles, 'curator');
  const isAdmin = memberHasRole(roles, 'admin') || isAdminEnv(staffTelegramId);
  if (!isCheck && !isCurator && !isAdmin) return false;

  const topic = await resolveStaffDmTopicByThread(
    admin,
    staffTelegramId,
    message.message_thread_id,
  );
  if (!topic) return false;

  const text = (message.text ?? message.caption ?? '').trim();
  if (text.startsWith('/')) return false;
  let attachmentRef: string | null = null;
  let attachmentKind: 'photo' | 'document' | 'voice' | null = null;

  if (message.voice?.file_id) {
    attachmentRef = formatTelegramFileRef(message.voice.file_id);
    attachmentKind = 'voice';
  } else if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    if (largest?.file_id) {
      attachmentRef = formatTelegramFileRef(largest.file_id);
      attachmentKind = 'photo';
    }
  } else if (message.document?.file_id) {
    attachmentRef = formatTelegramFileRef(message.document.file_id);
    attachmentKind = 'document';
  }

  if (!text && !attachmentRef) return false;

  const result = await deliverStaffTopicReplyToStudent(admin, topic, {
    body: text || (attachmentKind === 'voice' ? 'Голосовое сообщение' : 'Вложение'),
    attachmentRef,
    attachmentKind,
    telegramMessageId: message.message_id,
  });

  if (!result.ok && result.error) {
    const chatId = message.chat?.id ?? staffTelegramId;
    const { telegramSend } = await import('@/lib/telegram');
    await telegramSend('sendMessage', {
      chat_id: chatId,
      message_thread_id: message.message_thread_id,
      text: `⚠️ ${result.error}`,
    }).catch(() => undefined);
  }
  return true;
}
