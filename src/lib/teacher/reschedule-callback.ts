import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { acceptRescheduleOption } from '@/lib/teacher/reschedule';

/** Inline-кнопки переноса: rs:pick:{proposalId}:{optionIndex} */
export async function handleRescheduleCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  fromTelegramId: number,
  callbackQueryId: string,
): Promise<boolean> {
  if (!data.startsWith('rs:pick:')) return false;

  const parts = data.split(':');
  const proposalId = Number(parts[2]);
  const optionIndex = Number(parts[3]);
  if (!Number.isFinite(proposalId) || !Number.isFinite(optionIndex)) return false;

  try {
    const ok = await acceptRescheduleOption(admin, {
      proposalId,
      optionIndex,
      studentTelegramId: fromTelegramId,
    });
    await telegramSend('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: ok ? 'Занятие перенесено' : 'Не удалось подтвердить перенос',
    });
    if (ok) {
      await telegramSend('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: '✅ Перенос подтверждён. Новое время сохранено в расписании.',
      });
    }
    return true;
  } catch {
    await telegramSend('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: 'Ошибка при переносе',
    });
    return true;
  }
}
