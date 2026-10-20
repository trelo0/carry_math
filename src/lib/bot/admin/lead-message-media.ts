import type { LeadMessageRow } from './lead-messages';
import { telegramSend } from '@/lib/telegram';

type LeadAttachment = {
  file_id?: string;
  kind?: string;
  file_name?: string;
  mime_type?: string;
};

export async function sendLeadMessageAttachment(
  chatId: number,
  row: Pick<LeadMessageRow, 'message_type' | 'attachment' | 'body'>,
): Promise<void> {
  const att = row.attachment as LeadAttachment | null;
  const fileId = att?.file_id?.trim();
  if (!fileId) return;

  const caption = row.body?.trim() || undefined;
  if (!att) return;
  const kind = att.kind ?? row.message_type;

  if (kind === 'photo') {
    await telegramSend('sendPhoto', { chat_id: chatId, photo: fileId, caption });
    return;
  }
  if (kind === 'voice' || att.mime_type?.startsWith('audio/')) {
    await telegramSend('sendVoice', { chat_id: chatId, voice: fileId, caption });
    return;
  }
  await telegramSend('sendDocument', { chat_id: chatId, document: fileId, caption });
}
