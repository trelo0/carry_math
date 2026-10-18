import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import type { InlineKeyboard } from './admin/core';

export const STUDENT_NTF_CLOSE = 'cl:ntf:close';

export function studentNotifyKeyboard(
  rows?: Array<Array<{ text: string; callback_data: string }>>,
): InlineKeyboard {
  const actionRows = rows ?? [];
  return {
    inline_keyboard: [
      ...actionRows,
      [{ text: 'Закрыть', callback_data: STUDENT_NTF_CLOSE }],
    ],
  };
}

export function homeworkReviewNotifyKeyboard(sanityLessonId: string): InlineKeyboard {
  return studentNotifyKeyboard([
    [
      {
        text: 'Посмотреть результат',
        callback_data: `cl:chw:rev:${sanityLessonId}`,
      },
    ],
  ]);
}

async function resolveStudentChatId(
  admin: SupabaseClient,
  studentTelegramId: number,
): Promise<number | undefined> {
  const { data } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', studentTelegramId)
    .maybeSingle();
  return data?.chat_id as number | undefined;
}

export async function sendStudentInfoPush(
  admin: SupabaseClient,
  studentTelegramId: number,
  text: string,
  extraRows?: Array<Array<{ text: string; callback_data: string }>>,
): Promise<void> {
  const chatId = await resolveStudentChatId(admin, studentTelegramId);
  if (!chatId) return;
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: studentNotifyKeyboard(extraRows),
  });
}

export async function notifyStudentHomeworkSubmitted(
  admin: SupabaseClient,
  studentTelegramId: number,
  params: { lessonNumber: number; title: string; sanityLessonId?: string },
): Promise<void> {
  const rows = params.sanityLessonId
    ? [
        [
          {
            text: 'Проверить статус',
            callback_data: `cl:chw:stat:${params.sanityLessonId}`,
          },
        ],
      ]
    : undefined;
  await sendStudentInfoPush(
    admin,
    studentTelegramId,
    `✅ ДЗ №${params.lessonNumber} «${params.title}» отправлено на проверку.\n\nОтвет придёт в Telegram.`,
    rows,
  );
}

export async function notifyStudentLifeDeducted(
  admin: SupabaseClient,
  studentTelegramId: number,
  params: { courseTitle?: string; livesLeft: number; livesMax?: number | null },
): Promise<void> {
  const chatId = await resolveStudentChatId(admin, studentTelegramId);
  if (!chatId) return;

  const maxPart =
    params.livesMax != null ? ` из ${params.livesMax}` : '';
  const courseLine = params.courseTitle?.trim() ? `\n🎓 ${params.courseTitle.trim()}` : '';
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text:
      `❤️ Снята 1 жизнь за просрочку или невыполнение ДЗ.${courseLine}\n\n` +
      `Осталось жизней: ${params.livesLeft}${maxPart}.`,
    reply_markup: studentNotifyKeyboard(),
  });
}
