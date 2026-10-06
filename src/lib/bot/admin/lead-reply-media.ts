import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { resolveMemberChatId } from '../staff/messaging';
import { type ConversationState, type IncomingDocument, sendAdminMessage, homeButton } from './core';
import { insertLeadMessage } from './lead-messages';
import { logLeadEvent } from './lead-events';
import { setLeadStatus } from './leads';

async function sendMediaToChat(
  chatId: number,
  document: IncomingDocument,
  caption?: string,
): Promise<{ ok: boolean; messageId?: number; description?: string }> {
  const cap = caption?.trim() || undefined;
  if (document.kind === 'photo') {
    const r = await telegramSend('sendPhoto', { chat_id: chatId, photo: document.fileId, caption: cap });
    return { ok: r.ok, messageId: r.result?.message_id, description: r.description };
  }
  if (document.mimeType?.startsWith('audio/') || document.fileName?.endsWith('.ogg')) {
    const r = await telegramSend('sendVoice', { chat_id: chatId, voice: document.fileId, caption: cap });
    return { ok: r.ok, messageId: r.result?.message_id, description: r.description };
  }
  const r = await telegramSend('sendDocument', {
    chat_id: chatId,
    document: document.fileId,
    caption: cap,
  });
  return { ok: r.ok, messageId: r.result?.message_id, description: r.description };
}

export async function handleAdminLeadReplyMedia(
  admin: SupabaseClient,
  adminTelegramId: number,
  state: ConversationState,
  document: IncomingDocument,
  caption?: string,
): Promise<boolean> {
  if (state.step !== 'admin:lead:reply') return false;
  const leadId = state.payload.leadReplyLeadId;
  const clientTgId = state.payload.leadReplyClientTelegramId;
  const nav = state.payload.leadReplyNav ?? 'a:0';
  if (!leadId || !clientTgId) return false;

  const chatId = await resolveMemberChatId(admin, clientTgId);
  if (!chatId) {
    await sendAdminMessage(state.chat_id, 'У клиента нет chat_id.');
    return true;
  }

  const messageType = document.kind === 'photo' ? 'photo' : document.mimeType?.startsWith('audio/') ? 'voice' : 'document';
  const result = await sendMediaToChat(chatId, document, caption);
  if (result.ok) {
    await insertLeadMessage(admin, {
      leadId,
      direction: 'admin_to_client',
      senderTelegramId: adminTelegramId,
      telegramMessageId: result.messageId ?? null,
      body: caption?.trim() || null,
      messageType,
      attachment: {
        file_id: document.fileId,
        kind: document.kind,
        file_name: document.fileName,
        mime_type: document.mimeType,
      },
    });
    await logLeadEvent(admin, {
      leadId,
      eventType: 'admin_reply',
      actorTelegramId: adminTelegramId,
      detail: { message_type: messageType },
    });
    await setLeadStatus(admin, leadId, 'in_progress', adminTelegramId);
  }

  await sendAdminMessage(
    state.chat_id,
    result.ok ? '✅ Вложение отправлено клиенту.' : `❌ ${result.description ?? 'ошибка'}`,
    {
      inline_keyboard: [
        [{ text: '⏹ Завершить переписку', callback_data: `al:rp:stop:${leadId}:${nav}` }],
        [{ text: '◀️ К заявке', callback_data: `al:l:${leadId}:${nav}` }],
        [homeButton()],
      ],
    },
  );
  return true;
}
