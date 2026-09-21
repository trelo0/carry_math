import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  clearStateIfAvailable,
  getState,
  isConversationStateTableError,
  saveState,
  sendAdminMessage,
  type AdminPayload,
} from '@/lib/bot/admin/core';
import {
  CourseHomeworkError,
  markHomeworkSubmitted,
  resolveSubmitTargetLesson,
} from '@/lib/bot/education/course-homework';
import { notifyCuratorHomeworkSubmitted } from '@/lib/curator/homework-events';

type SubmitPayload = AdminPayload & { sanityLessonId?: string };

export function formatTelegramFileRef(fileId: string): string {
  return `tg:${fileId}`;
}

export async function beginCourseHomeworkSubmit(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  preferredSanityLessonId?: string,
): Promise<boolean> {
  const target = await resolveSubmitTargetLesson(admin, telegramId, preferredSanityLessonId);
  if (!target) {
    await sendAdminMessage(
      chatId,
      'Сейчас нет домашних заданий, которые можно сдать.\n\nПосмотрите запись занятия в личном кабинете — после этого здесь появится возможность отправить работу.',
    );
    return true;
  }

  const { lesson } = target;
  const text =
    `📝 Сдать домашку\n\n` +
    `Занятие №${lesson.lessonNumber}: ${lesson.title}\n\n` +
    `Отправьте фото, PDF или текст ответа одним сообщением.\n\n` +
    `⬅️ Отмена — напишите «Отмена».`;

  try {
    await saveState(admin, telegramId, { chatId, messageId: 0 }, 'student:course-hw-submit', {
      sanityLessonId: lesson.sanityId,
    });
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  await sendAdminMessage(chatId, text);
  return true;
}

async function finishSubmit(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  sanityLessonId: string,
  input: { note?: string; fileUrl?: string },
): Promise<void> {
  await markHomeworkSubmitted(admin, telegramId, sanityLessonId, input);
  await notifyCuratorHomeworkSubmitted(admin, telegramId, sanityLessonId, input);
  await clearStateIfAvailable(admin, telegramId);
  await sendAdminMessage(
    chatId,
    '✅ Домашка отправлена на проверку.\n\nСтатус можно посмотреть в личном кабинете в разделе «Курс».',
  );
}

export async function handleStudentHomeworkMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }

  if (!state || state.step !== 'student:course-hw-submit') return false;
  const payload = state.payload as SubmitPayload;
  const sanityLessonId = payload.sanityLessonId;
  if (!sanityLessonId) return false;

  if (text.trim().toLowerCase() === 'отмена') {
    await clearStateIfAvailable(admin, telegramId);
    await sendAdminMessage(chatId, 'Сдача домашки отменена.');
    return true;
  }

  try {
    await finishSubmit(admin, telegramId, chatId, sanityLessonId, { note: text.trim() });
  } catch (error) {
    const message = error instanceof CourseHomeworkError ? error.message : 'Не удалось отправить домашку.';
    await sendAdminMessage(chatId, message);
  }
  return true;
}

export async function handleStudentHomeworkAttachment(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  attachment: { fileId: string; kind: 'document' | 'photo'; fileName?: string },
): Promise<boolean> {
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }

  if (!state || state.step !== 'student:course-hw-submit') return false;
  const payload = state.payload as SubmitPayload;
  const sanityLessonId = payload.sanityLessonId;
  if (!sanityLessonId) return false;

  const note =
    attachment.kind === 'document' && attachment.fileName
      ? `Файл: ${attachment.fileName}`
      : attachment.kind === 'photo'
        ? 'Фото домашки'
        : undefined;

  try {
    await finishSubmit(admin, telegramId, chatId, sanityLessonId, {
      note,
      fileUrl: formatTelegramFileRef(attachment.fileId),
    });
  } catch (error) {
    const message = error instanceof CourseHomeworkError ? error.message : 'Не удалось отправить домашку.';
    await sendAdminMessage(chatId, message);
  }
  return true;
}

export async function notifyStudentHomeworkReviewed(
  admin: SupabaseClient,
  studentTelegramId: number,
  params: { lessonNumber: number; title: string; approved: boolean; note?: string },
): Promise<void> {
  const { data } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', studentTelegramId)
    .maybeSingle();
  const chatId = data?.chat_id as number | undefined;
  if (!chatId) return;

  const base = params.approved
    ? `✅ Домашка по занятию №${params.lessonNumber} «${params.title}» принята.`
    : `❌ Домашка по занятию №${params.lessonNumber} «${params.title}» отправлена на доработку.`;
  const text = params.note?.trim() ? `${base}\n\nКомментарий:\n${params.note.trim()}` : base;
  await telegramSend('sendMessage', { chat_id: chatId, text });
}

export async function sendSubmissionToCurator(
  admin: SupabaseClient,
  curatorTelegramId: number,
  submission: { fileUrl: string | null; note: string | null; lessonNumber: number; title: string; studentName: string },
): Promise<void> {
  const { data } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', curatorTelegramId)
    .maybeSingle();
  const chatId = data?.chat_id as number | undefined;
  if (!chatId) return;

  if (submission.note?.trim()) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text:
        `📎 Работа ученика ${submission.studentName}\n` +
        `Занятие №${submission.lessonNumber}: ${submission.title}\n\n` +
        submission.note.trim(),
    });
  }

  if (submission.fileUrl?.startsWith('tg:')) {
    const fileId = submission.fileUrl.slice(3);
    await telegramSend('sendDocument', { chat_id: chatId, document: fileId });
  } else if (submission.fileUrl?.startsWith('http')) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: `🔗 Файл: ${submission.fileUrl}`,
    });
  }
}
