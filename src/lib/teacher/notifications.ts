import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { formatLessonDateTimeRu } from '@/lib/teacher/format';

export async function notifyStudentLessonCancelled(
  admin: SupabaseClient,
  studentTelegramId: number,
  params: {
    kind: 'individual' | 'group';
    topic: string;
    startsAt: string;
  },
): Promise<void> {
  const { data } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', studentTelegramId)
    .maybeSingle();
  const chatId = data?.chat_id as number | undefined;
  if (!chatId) return;

  const kindLabel = params.kind === 'group' ? 'Групповое' : 'Индивидуальное';
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: [
      '❌ Занятие отменено преподавателем',
      '',
      `📦 ${kindLabel}`,
      `📝 ${params.topic}`,
      `🕐 ${formatLessonDateTimeRu(params.startsAt)}`,
    ].join('\n'),
  });
}
