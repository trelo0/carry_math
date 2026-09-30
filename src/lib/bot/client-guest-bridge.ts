import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { refreshClientMenu } from './client-flow';
import type { BotRole } from './roles';

const REDIRECT_TO_CLIENT = new Set(['guest:main', 'guest:begin']);

/** Маркетинговые guest:* для клиентского UI → актуальное Reply-меню. */
export async function bridgeGuestCallbackForClient(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId: string | undefined,
  memberRole?: BotRole,
): Promise<boolean> {
  if (!data.startsWith('guest:') || !REDIRECT_TO_CLIENT.has(data)) return false;

  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: 'Откройте меню под полем ввода',
    });
  }

  await telegramSend('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: 'Меню бота обновлено. Используйте кнопки под полем ввода.',
  }).catch(() => undefined);

  await refreshClientMenu(admin, telegramId, chatId, memberRole);
  return true;
}
