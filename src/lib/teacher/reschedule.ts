import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { formatLessonDateTimeRu } from '@/lib/teacher/format';

export type RescheduleOption = { startsAt: string };

export async function createRescheduleProposal(
  admin: SupabaseClient,
  params: {
    lessonId: number;
    teacherTelegramId: number;
    options: RescheduleOption[];
  },
): Promise<number> {
  if (params.options.length < 1 || params.options.length > 3) {
    throw new Error('Укажите от 1 до 3 вариантов переноса.');
  }

  const { data: lesson, error: lessonError } = await admin
    .from('scheduled_lessons')
    .select('id, telegram_id, teacher_telegram_id, status, topic, starts_at, kind')
    .eq('id', params.lessonId)
    .maybeSingle();
  if (lessonError) throw lessonError;
  if (!lesson) throw new Error('Занятие не найдено.');
  if (lesson.teacher_telegram_id !== params.teacherTelegramId) {
    throw new Error('Нет доступа к этому занятию.');
  }
  if (lesson.status !== 'scheduled') {
    throw new Error('Перенести можно только запланированное занятие.');
  }

  await admin
    .from('lesson_reschedule_proposals')
    .update({ status: 'cancelled' })
    .eq('lesson_id', params.lessonId)
    .eq('status', 'pending');

  const { data: proposal, error } = await admin
    .from('lesson_reschedule_proposals')
    .insert({
      lesson_id: params.lessonId,
      proposed_by: params.teacherTelegramId,
      options: params.options,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error) throw error;

  const studentTelegramId = lesson.telegram_id as number;
  const { data: student } = await admin
    .from('bot_members')
    .select('chat_id, full_name')
    .eq('telegram_id', studentTelegramId)
    .maybeSingle();

  const chatId = student?.chat_id as number | undefined;
  if (chatId) {
    const kindLabel = lesson.kind === 'group' ? 'Групповое' : 'Индивидуальное';
    const lines = [
      '📅 Преподаватель предлагает перенести занятие',
      '',
      `📦 ${kindLabel}`,
      `📝 ${lesson.topic}`,
      `🕐 Было: ${formatLessonDateTimeRu(lesson.starts_at as string)}`,
      '',
      'Выбери удобный вариант:',
    ];
    const keyboard = params.options.map((opt, index) => [
      {
        text: formatLessonDateTimeRu(opt.startsAt),
        callback_data: `rs:pick:${proposal.id}:${index}`,
      },
    ]);
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: lines.join('\n'),
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  return proposal.id as number;
}

export async function acceptRescheduleOption(
  admin: SupabaseClient,
  params: {
    proposalId: number;
    optionIndex: number;
    studentTelegramId: number;
  },
): Promise<boolean> {
  const { data: proposal, error } = await admin
    .from('lesson_reschedule_proposals')
    .select('id, lesson_id, proposed_by, options, status')
    .eq('id', params.proposalId)
    .maybeSingle();
  if (error) throw error;
  if (!proposal || proposal.status !== 'pending') return false;

  const { data: lesson } = await admin
    .from('scheduled_lessons')
    .select('telegram_id, topic, kind')
    .eq('id', proposal.lesson_id)
    .maybeSingle();
  if (!lesson || lesson.telegram_id !== params.studentTelegramId) return false;

  const options = proposal.options as RescheduleOption[];
  const chosen = options[params.optionIndex];
  if (!chosen?.startsAt) return false;

  const now = new Date().toISOString();
  await admin
    .from('scheduled_lessons')
    .update({ starts_at: chosen.startsAt, updated_at: now })
    .eq('id', proposal.lesson_id);

  await admin
    .from('lesson_reschedule_proposals')
    .update({
      status: 'accepted',
      chosen_starts_at: chosen.startsAt,
      chosen_at: now,
    })
    .eq('id', params.proposalId);

  const teacherTelegramId = proposal.proposed_by as number;
  const { data: teacher } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', teacherTelegramId)
    .maybeSingle();
  const teacherChatId = teacher?.chat_id as number | undefined;
  if (teacherChatId) {
    const kindLabel = lesson.kind === 'group' ? 'Групповое' : 'Индивидуальное';
    await telegramSend('sendMessage', {
      chat_id: teacherChatId,
      text: [
        '✅ Ученик подтвердил перенос',
        '',
        `📦 ${kindLabel}`,
        `📝 ${lesson.topic}`,
        `🕐 Новое время: ${formatLessonDateTimeRu(chosen.startsAt)}`,
      ].join('\n'),
    });
  }

  return true;
}
