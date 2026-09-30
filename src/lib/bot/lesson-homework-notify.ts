import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { formatLessonDateTimeRu } from '@/lib/teacher/format';

async function resolveChatId(admin: SupabaseClient, telegramId: number): Promise<number | null> {
  const { data, error } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  const chatId = data?.chat_id;
  return typeof chatId === 'number' ? chatId : null;
}

export async function notifyStudentLessonHomeworkAssigned(
  admin: SupabaseClient,
  studentTelegramId: number,
  params: { lessonId: number; topic: string; startsAt: string },
): Promise<void> {
  const chatId = await resolveChatId(admin, studentTelegramId);
  if (!chatId) return;

  const dateLabel = formatLessonDateTimeRu(params.startsAt);
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: [
      '📝 Преподаватель добавил домашнее задание',
      '',
      `Занятие: ${params.topic}`,
      `Дата: ${dateLabel}`,
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Открыть задание', callback_data: `cl:hw:open:${params.lessonId}` }],
        [{ text: 'Перейти к занятию', callback_data: `cl:less:v:${params.lessonId}:menu` }],
      ],
    },
  });
}

export async function notifyTeacherLessonHomeworkSubmitted(
  admin: SupabaseClient,
  lessonId: number,
  studentTelegramId: number,
): Promise<void> {
  const { data: lesson, error } = await admin
    .from('scheduled_lessons')
    .select('topic, starts_at, teacher_telegram_id')
    .eq('id', lessonId)
    .maybeSingle();
  if (error) throw error;
  if (!lesson?.teacher_telegram_id) return;

  const teacherChatId = await resolveChatId(admin, lesson.teacher_telegram_id as number);
  if (!teacherChatId) return;

  const { data: student } = await admin
    .from('bot_members')
    .select('full_name, phone')
    .eq('telegram_id', studentTelegramId)
    .maybeSingle();

  const studentLabel =
    (student?.full_name as string | null)?.trim() ||
    (student?.phone as string | null)?.trim() ||
    `ID ${studentTelegramId}`;

  await telegramSend('sendMessage', {
    chat_id: teacherChatId,
    text: [
      '📝 Домашняя работа на проверке',
      '',
      `👤 ${studentLabel}`,
      `📚 ${lesson.topic as string}`,
      `🕐 ${formatLessonDateTimeRu(lesson.starts_at as string)}`,
      '',
      'Откройте занятие в кабинете преподавателя.',
    ].join('\n'),
  });
}

export async function notifyStudentLessonHomeworkReviewed(
  admin: SupabaseClient,
  studentTelegramId: number,
  params: { lessonId: number; topic: string; approved: boolean; comment?: string },
): Promise<void> {
  const chatId = await resolveChatId(admin, studentTelegramId);
  if (!chatId) return;

  const lines = [
    params.approved ? '✅ Домашнее задание принято' : '🔄 Нужна доработка',
    '',
    params.topic,
  ];
  if (params.comment) lines.push('', params.comment);
  lines.push('', 'Откройте карточку занятия для деталей.');

  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: lines.join('\n'),
    reply_markup: {
      inline_keyboard: [[{ text: 'Открыть задание', callback_data: `cl:hw:open:${params.lessonId}` }]],
    },
  });
}
