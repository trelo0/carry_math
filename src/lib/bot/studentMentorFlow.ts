import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  clearStateIfAvailable,
  getState,
  isConversationStateTableError,
  saveState,
  sendAdminMessage,
} from './admin/core';
import { getStudentCurator, getStudentTeacher } from './education/assignments';
import { notifyAdminsOfSupportMessage } from './studentSupportFlow';

async function resolveMentorChatId(
  admin: SupabaseClient,
  mentorTelegramId: number,
): Promise<number | null> {
  const { data, error } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', mentorTelegramId)
    .maybeSingle();
  if (error) throw error;
  const chatId = data?.chat_id;
  return typeof chatId === 'number' ? chatId : null;
}

async function studentLabel(admin: SupabaseClient, telegramId: number): Promise<string> {
  const [{ data: member }, { data: link }] = await Promise.all([
    admin.from('bot_members').select('full_name, phone').eq('telegram_id', telegramId).maybeSingle(),
    admin.from('telegram_links').select('phone').eq('telegram_id', telegramId).maybeSingle(),
  ]);
  const phone = link?.phone ?? member?.phone;
  const name = member?.full_name;
  if (name && phone) return `${name} · ${phone}`;
  if (name) return name;
  if (phone) return phone;
  return `ID ${telegramId}`;
}

export async function beginStudentMentorQuestion(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  options: { homework?: boolean } = {},
): Promise<void> {
  const teacher = await getStudentTeacher(admin, telegramId);
  const mentor = teacher ?? (await getStudentCurator(admin, telegramId));

  try {
    await saveState(admin, telegramId, { chatId, messageId: 0 }, 'student:mentor', {
      mentorTelegramId: mentor?.telegramId,
      homework: options.homework ?? false,
    });
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  if (!mentor) {
    await sendAdminMessage(
      chatId,
      '💬 Наставник пока не назначен.\n\n' +
        'Напишите вопрос одним сообщением — мы передадим его в поддержку и свяжем с наставником.\n\n' +
        '⬅️ Отмена — «Отмена».',
    );
    return;
  }

  const intro = options.homework
    ? `📝 Сдать домашку\n\nНаставник: ${mentor.fullName ?? 'преподаватель'}\n\n`
    : `💬 Вопрос наставнику\n\n${mentor.fullName ?? 'Наставник'}\n\n`;

  await sendAdminMessage(
    chatId,
    intro +
      'Отправьте текст, фото или документ одним сообщением.\n\n' +
      '⬅️ Отмена — «Отмена».',
  );
}

async function forwardToMentor(
  admin: SupabaseClient,
  studentTelegramId: number,
  mentorTelegramId: number | undefined,
  body: string,
): Promise<'mentor' | 'support'> {
  if (!mentorTelegramId) return 'support';

  const mentorChatId = await resolveMentorChatId(admin, mentorTelegramId);
  if (!mentorChatId) return 'support';

  const label = await studentLabel(admin, studentTelegramId);
  await telegramSend('sendMessage', {
    chat_id: mentorChatId,
    text: ['💬 Сообщение от ученика', '', `👤 ${label}`, '', body].join('\n'),
  });
  return 'mentor';
}

export async function handleStudentMentorMessage(
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
  if (!state || state.step !== 'student:mentor') return false;

  const trimmed = text.trim();
  if (!trimmed || /^отмена$/i.test(trimmed)) {
    await clearStateIfAvailable(admin, telegramId);
    await sendAdminMessage(chatId, 'Обращение отменено.');
    return true;
  }

  const mentorTelegramId = state.payload.mentorTelegramId as number | undefined;
  const target = await forwardToMentor(admin, telegramId, mentorTelegramId, trimmed);
  if (target === 'support') {
    await notifyAdminsOfSupportMessage(admin, telegramId, trimmed);
  }
  await clearStateIfAvailable(admin, telegramId);

  await sendAdminMessage(
    chatId,
    target === 'mentor'
      ? '✅ Сообщение отправлено наставнику.\n\nОтвет придёт в Telegram.'
      : '✅ Сообщение отправлено в поддержку.\n\nМы свяжем вас с наставником.',
  );
  return true;
}

export async function handleStudentMentorAttachment(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  caption: string,
): Promise<boolean> {
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }
  if (!state || state.step !== 'student:mentor') return false;

  const mentorTelegramId = state.payload.mentorTelegramId as number | undefined;
  const body = caption.trim() ? `📎 Вложение\n\n${caption.trim()}` : '📎 Вложение (файл отправлен из Telegram)';
  const target = await forwardToMentor(admin, telegramId, mentorTelegramId, body);
  if (target === 'support') {
    await notifyAdminsOfSupportMessage(admin, telegramId, body);
  }
  await clearStateIfAvailable(admin, telegramId);

  await sendAdminMessage(
    chatId,
    target === 'mentor'
      ? '✅ Вложение отправлено наставнику.'
      : '✅ Вложение отправлено в поддержку.',
  );
  return true;
}
