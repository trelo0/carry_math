import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  botPrivateTopicUrl,
  openStaffStudentDmTopic,
  staffDmTopicsEnabled,
  type DmTopicStaffRole,
} from './dm-topics';

export async function openStaffDmTopicAndNavigate(
  admin: SupabaseClient,
  params: {
    staffTelegramId: number;
    studentTelegramId: number;
    staffRole: DmTopicStaffRole;
    courseIdHint?: number | null;
    introText?: string;
    callbackQueryId?: string;
    notifyChatId?: number;
  },
): Promise<{ ok: boolean; error?: string }> {
  if (!staffDmTopicsEnabled()) {
    return { ok: false, error: 'Topics отключены.' };
  }
  const opened = await openStaffStudentDmTopic(admin, {
    staffTelegramId: params.staffTelegramId,
    studentTelegramId: params.studentTelegramId,
    staffRole: params.staffRole,
    courseIdHint: params.courseIdHint,
    introText: params.introText,
  });
  if (!opened.ok || opened.messageThreadId == null) {
    return { ok: false, error: opened.error ?? 'Не удалось открыть тему.' };
  }
  const url = botPrivateTopicUrl(opened.messageThreadId);
  if (params.callbackQueryId && url) {
    const answered = await telegramSend('answerCallbackQuery', {
      callback_query_id: params.callbackQueryId,
      url,
    });
    if (answered.ok) return { ok: true };
  }
  if (params.notifyChatId && url) {
    await telegramSend('sendMessage', {
      chat_id: params.notifyChatId,
      text: '💬 Диалог с учеником',
      reply_markup: {
        inline_keyboard: [[{ text: 'Открыть переписку', url }]],
      },
    });
    return { ok: true };
  }
  return { ok: true };
}
