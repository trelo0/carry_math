import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clearStateIfAvailable,
  getState,
  isConversationStateTableError,
  saveState,
  sendAdminMessage,
} from './admin/core';
import { memberHasRole, loadMemberRoles } from './roles';
import { getStudentCurator, getStudentTeacher } from './education/assignments';
import { notifyStaffInboundFromStudent, type StaffMessageRole } from './staff/messaging';
import { notifyAdminsOfSupportMessage } from './studentSupportFlow';

export type StudentMentorContext = 'course' | 'lessons';

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

export async function beginStudentMentorQuestion(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  options: { homework?: boolean; context?: StudentMentorContext } = {},
): Promise<void> {
  const context = options.context ?? 'lessons';
  const teacher = await getStudentTeacher(admin, telegramId);
  const curator = await getStudentCurator(admin, telegramId);

  let mentor = teacher;
  let staffRole: StaffMessageRole | undefined;

  if (context === 'course') {
    mentor = curator ?? teacher;
    if (curator) staffRole = 'curator';
    else if (teacher) staffRole = 'teacher';
  } else {
    mentor = teacher ?? curator;
    if (teacher) staffRole = 'teacher';
    else if (curator) staffRole = 'curator';
  }

  try {
    await saveState(admin, telegramId, { chatId, messageId: 0 }, 'student:mentor', {
      mentorTelegramId: mentor?.telegramId,
      homework: options.homework ?? false,
      staffRole,
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

  const roleHint =
    staffRole === 'curator' ? 'куратору курса' : staffRole === 'teacher' ? 'преподавателю' : 'наставнику';

  const intro = options.homework
    ? `📝 Сдать домашку\n\nНаставник: ${mentor.fullName ?? roleHint}\n\n`
    : `💬 Вопрос ${context === 'course' ? 'по курсу' : 'наставнику'}\n\n${mentor.fullName ?? 'Наставник'}\n\n`;

  await sendAdminMessage(
    chatId,
    intro +
      'Отправьте текст, фото или документ одним сообщением.\n\n' +
      '⬅️ Отмена — «Отмена».',
  );
}

async function resolveStaffRoleForMentor(
  admin: SupabaseClient,
  mentorTelegramId: number,
): Promise<StaffMessageRole | null> {
  const roles = await loadMemberRoles(admin, mentorTelegramId);
  if (memberHasRole(roles, 'teacher')) return 'teacher';
  if (memberHasRole(roles, 'curator')) return 'curator';
  return null;
}

async function forwardToMentor(
  admin: SupabaseClient,
  studentTelegramId: number,
  mentorTelegramId: number | undefined,
  body: string,
  staffRoleOverride?: StaffMessageRole,
  attachment?: { ref: string; kind: 'photo' | 'document' },
): Promise<'mentor' | 'support'> {
  if (!mentorTelegramId) return 'support';

  const mentorChatId = await resolveMentorChatId(admin, mentorTelegramId);
  if (!mentorChatId) return 'support';

  const staffRole =
    staffRoleOverride ?? (await resolveStaffRoleForMentor(admin, mentorTelegramId));
  if (!staffRole) return 'support';

  await notifyStaffInboundFromStudent(admin, {
    staffTelegramId: mentorTelegramId,
    staffRole,
    studentTelegramId,
    body,
    attachmentRef: attachment?.ref,
    attachmentKind: attachment?.kind,
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
  const staffRole = state.payload.staffRole as StaffMessageRole | undefined;
  const target = await forwardToMentor(admin, telegramId, mentorTelegramId, trimmed, staffRole);
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
  attachment: { fileId: string; kind: 'photo' | 'document' },
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
  const staffRole = state.payload.staffRole as StaffMessageRole | undefined;
  const body = caption.trim() ? caption.trim() : 'Вложение';
  const target = await forwardToMentor(admin, telegramId, mentorTelegramId, body, staffRole, {
    ref: `tg:${attachment.fileId}`,
    kind: attachment.kind,
  });
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
