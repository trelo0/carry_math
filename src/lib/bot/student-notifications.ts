import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';

function formatLessonDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function notifyStudentLessonScheduled(
  admin: SupabaseClient,
  telegramId: number,
  params: {
    kind: 'individual' | 'group';
    topic: string;
    startsAt: string;
    meetUrl?: string | null;
  },
): Promise<void> {
  const { data } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  const chatId = data?.chat_id as number | undefined;
  if (!chatId) return;

  const kindLabel = params.kind === 'individual' ? 'Индивидуальное' : 'Групповое';
  const cabinetUrl = await createCabinetLoginUrl(admin, telegramId, '/cabinet?section=lessons');
  const lines = [
    '📅 Назначено новое занятие',
    '',
    `📦 ${kindLabel}`,
    `📝 ${params.topic}`,
    `🕐 ${formatLessonDateTime(params.startsAt)}`,
  ];
  if (params.meetUrl) lines.push(`🔗 ${params.meetUrl}`);
  lines.push('', 'Открой личный кабинет:', cabinetUrl);

  await telegramSend('sendMessage', { chat_id: chatId, text: lines.join('\n') });
}
