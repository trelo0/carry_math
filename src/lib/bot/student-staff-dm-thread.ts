import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clearStateIfAvailable,
  getState,
  isConversationStateTableError,
  saveState,
  sendAdminMessage,
} from './admin/core';
import { saveClientDialogState } from './client-nav';
import { isClientReplyLabel } from './client-menu';
import { getStudentCurator } from './education/assignments';
import { resolvePrimaryAdminTelegramId } from './admin/admin-guest-inbox';
import { notifyStaffInboundFromStudent, type StaffMessageRole } from './staff/messaging';
import { studentNotifyKeyboard } from './student-push-notify';
import { insertLeadMessage } from './admin/lead-messages';
import { logLeadEvent } from './admin/lead-events';
import { setLeadStatus } from './admin/leads';

export const STUDENT_STAFF_DM_STEP = 'student:staff-dm' as const;

export type StudentStaffDmPayload = {
  staffTelegramId: number;
  staffRole: Extract<StaffMessageRole, 'admin' | 'curator' | 'check'>;
  courseId?: number;
  inquiryLeadId?: string;
};

const THREAD_HINT =
  'Можете отправить ещё сообщение или нажать «Отмена», чтобы выйти из диалога.';

function threadKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '❌ Отмена', callback_data: 'cl:staff-dm:cancel' }],
      ...studentNotifyKeyboard().inline_keyboard,
    ],
  };
}

export async function saveStudentStaffDmState(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  payload: StudentStaffDmPayload,
): Promise<void> {
  try {
    await saveClientDialogState(admin, telegramId, chatId, STUDENT_STAFF_DM_STEP, payload as never);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    await saveState(admin, telegramId, { chatId, messageId: 0 }, STUDENT_STAFF_DM_STEP, payload as never);
  }
}

export async function beginStudentStaffDmThread(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  payload: StudentStaffDmPayload,
  prompt?: string,
): Promise<void> {
  await saveStudentStaffDmState(admin, telegramId, chatId, payload);
  const roleLabel =
    payload.staffRole === 'admin'
      ? 'администратору'
      : payload.staffRole === 'check'
        ? 'проверяющему ДЗ'
        : 'куратору';
  await sendAdminMessage(
    chatId,
    prompt ?? `✍️ Диалог с ${roleLabel}.\n\n${THREAD_HINT}`,
    threadKeyboard(),
  );
}

export async function beginStudentAdminDmThread(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
): Promise<void> {
  const adminId = await resolvePrimaryAdminTelegramId(admin);
  if (!adminId) {
    await sendAdminMessage(chatId, 'Администратор временно недоступен. Попробуйте позже.');
    return;
  }
  await beginStudentStaffDmThread(admin, telegramId, chatId, {
    staffTelegramId: adminId,
    staffRole: 'admin',
  });
}

export async function beginStudentCuratorDmThread(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  courseId: number,
): Promise<void> {
  const curator = await getStudentCurator(admin, telegramId, { courseId });
  if (!curator?.telegramId) {
    await sendAdminMessage(chatId, 'Куратор курса пока не назначен. Напишите администратору.');
    return;
  }
  await beginStudentStaffDmThread(admin, telegramId, chatId, {
    staffTelegramId: curator.telegramId,
    staffRole: 'curator',
    courseId,
  });
}

export async function deliverStudentPlainToStaffTopic(
  admin: SupabaseClient,
  telegramId: number,
  payload: StudentStaffDmPayload,
  body: string,
  attachment?: { ref: string; kind: 'photo' | 'document' | 'voice' },
  topicDelivery?: { contextIntro?: string; skipTopic?: boolean; plain?: boolean },
): Promise<void> {
  await notifyStaffInboundFromStudent(admin, {
    staffTelegramId: payload.staffTelegramId,
    staffRole: payload.staffRole,
    studentTelegramId: telegramId,
    body,
    attachmentRef: attachment?.ref,
    attachmentKind: attachment?.kind,
    courseId: payload.courseId ?? null,
    topicDelivery: {
      plain: topicDelivery?.contextIntro ? true : (topicDelivery?.plain ?? true),
      contextIntro: topicDelivery?.contextIntro,
      skipTopic: topicDelivery?.skipTopic,
    },
  });
}

function readPayload(state: { payload?: Record<string, unknown> } | null): StudentStaffDmPayload | null {
  const p = state?.payload;
  if (!p) return null;
  const staffTelegramId = p.staffTelegramId as number | undefined;
  const staffRole = p.staffRole as StudentStaffDmPayload['staffRole'] | undefined;
  if (!staffTelegramId || !staffRole) return null;
  if (staffRole !== 'admin' && staffRole !== 'curator' && staffRole !== 'check') return null;
  return {
    staffTelegramId,
    staffRole,
    courseId: p.courseId as number | undefined,
    inquiryLeadId: p.inquiryLeadId as string | undefined,
  };
}

async function appendLeadIfNeeded(
  admin: SupabaseClient,
  payload: StudentStaffDmPayload,
  telegramId: number,
  body: string,
  media?: { fileId: string; kind: 'photo' | 'document' | 'voice'; fileName?: string; mimeType?: string },
): Promise<void> {
  const leadId = payload.inquiryLeadId;
  if (!leadId) return;
  await insertLeadMessage(admin, {
    leadId,
    direction: 'client_to_admin',
    senderTelegramId: telegramId,
    body: body || null,
    messageType: media?.kind ?? 'text',
    attachment: media
      ? {
          file_id: media.fileId,
          kind: media.kind,
          file_name: media.fileName,
          mime_type: media.mimeType,
        }
      : undefined,
  });
  await logLeadEvent(admin, {
    leadId,
    eventType: 'client_message',
    actorTelegramId: telegramId,
    detail: { length: body.length },
  });
  await setLeadStatus(admin, leadId, 'awaiting_reply', null);
}

export async function handleStudentStaffDmMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  if (isClientReplyLabel(text)) return false;
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }
  if (state?.step !== STUDENT_STAFF_DM_STEP) return false;
  const payload = readPayload(state);
  if (!payload) return false;
  const trimmed = text.trim();
  if (!trimmed) return true;
  await appendLeadIfNeeded(admin, payload, telegramId, trimmed);
  await deliverStudentPlainToStaffTopic(admin, telegramId, payload, trimmed, undefined, {
    plain: true,
  });
  await sendAdminMessage(chatId, '✅ Сообщение отправлено.', threadKeyboard());
  return true;
}

export async function handleStudentStaffDmAttachment(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  caption: string,
  media?: { fileId: string; kind: 'photo' | 'document' | 'voice' },
): Promise<boolean> {
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }
  if (state?.step !== STUDENT_STAFF_DM_STEP) return false;
  const payload = readPayload(state);
  if (!payload) return false;
  const body = caption.trim() || (media?.kind === 'voice' ? 'Голосовое сообщение' : 'Вложение');
  await appendLeadIfNeeded(admin, payload, telegramId, body, media);
  await deliverStudentPlainToStaffTopic(
    admin,
    telegramId,
    payload,
    body,
    media ? { ref: `tg:${media.fileId}`, kind: media.kind } : undefined,
    { plain: true },
  );
  await sendAdminMessage(chatId, '✅ Вложение отправлено.', threadKeyboard());
  return true;
}

export async function handleStudentStaffDmCancel(
  admin: SupabaseClient,
  telegramId: number,
): Promise<void> {
  await clearStateIfAvailable(admin, telegramId);
}
