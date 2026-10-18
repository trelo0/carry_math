import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  clearStateIfAvailable,
  getState,
  isConversationStateTableError,
  saveState,
  type AdminPayload,
} from '@/lib/bot/admin/core';
import { staffHasCourseAccess } from '@/lib/bot/education/course-staff';
import type { StaffCourseAssignmentRole } from '@/lib/staff/course-assignment-ui';
import { staffCourseWorkspaceReplyKeyboard, staffGlobalReplyKeyboard } from './staff-menu';
import { loadStaffCapabilities } from './capabilities';

export const STAFF_COURSE_WORKSPACE_STEP = 'staff:course-workspace';

export type StaffCourseWorkspace = {
  courseId: number;
  role: StaffCourseAssignmentRole;
  courseTitle: string;
  courseSlug: string;
};

export const STAFF_WORKSPACE_PAYLOAD_KEY = 'staffWorkspace';

export function workspaceFromPayload(payload: AdminPayload | undefined): StaffCourseWorkspace | null {
  if (!payload) return null;
  const embedded = payload.staffWorkspace ?? (payload[STAFF_WORKSPACE_PAYLOAD_KEY] as StaffCourseWorkspace | undefined);
  if (embedded?.courseId && embedded.role) return embedded;
  if (payload.courseId && payload.staffRole) {
    return {
      courseId: payload.courseId as number,
      role: payload.staffRole as StaffCourseAssignmentRole,
      courseTitle: String(payload.courseTitle ?? 'Курс'),
      courseSlug: String(payload.courseSlug ?? ''),
    };
  }
  return null;
}

export async function getStaffCourseWorkspace(
  admin: SupabaseClient,
  telegramId: number,
): Promise<StaffCourseWorkspace | null> {
  try {
    const state = await getState(admin, telegramId);
    if (!state?.payload) return null;
    if (state.step === STAFF_COURSE_WORKSPACE_STEP) {
      return workspaceFromPayload(state.payload as AdminPayload);
    }
    return workspaceFromPayload(state.payload as AdminPayload);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return null;
  }
}

export async function assertStaffCourseWorkspace(
  admin: SupabaseClient,
  telegramId: number,
  courseId?: number,
  role?: StaffCourseAssignmentRole,
): Promise<StaffCourseWorkspace> {
  const ws = await getStaffCourseWorkspace(admin, telegramId);
  if (!ws) throw new Error('Сначала выберите курс в «Управление курсами».');
  if (courseId != null && ws.courseId !== courseId) {
    throw new Error('Действие относится к другому курсу. Выйдите и выберите курс снова.');
  }
  if (role != null && ws.role !== role) {
    throw new Error('Нет доступа в этом режиме курса.');
  }
  const ok = await staffHasCourseAccess(admin, telegramId, ws.courseId, ws.role);
  if (!ok) throw new Error('Нет назначения на этот курс.');
  return ws;
}

function workspacePayload(ws: StaffCourseWorkspace): AdminPayload {
  return {
    courseId: ws.courseId,
    staffRole: ws.role,
    courseTitle: ws.courseTitle,
    courseSlug: ws.courseSlug,
    staffWorkspace: ws,
  };
}

export function workspaceWelcomeText(ws: StaffCourseWorkspace): string {
  const roleLabel = ws.role === 'curator' ? 'куратор' : 'проверяющий ДЗ';
  return (
    `🎓 ${ws.courseTitle}\n\n` +
    `Режим: ${roleLabel}.\n` +
    'Все разделы меню ниже относятся только к этому курсу.\n\n' +
    '«⬅️ Все курсы» — вернуться к списку назначений.'
  );
}

export async function enterStaffCourseWorkspace(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  ws: StaffCourseWorkspace,
): Promise<void> {
  const ok = await staffHasCourseAccess(admin, telegramId, ws.courseId, ws.role);
  if (!ok) throw new Error('Нет назначения на этот курс.');

  try {
    await saveState(
      admin,
      telegramId,
      { chatId, messageId: 0 },
      STAFF_COURSE_WORKSPACE_STEP,
      workspacePayload(ws),
    );
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: workspaceWelcomeText(ws),
    reply_markup: staffCourseWorkspaceReplyKeyboard(ws.role),
  });
}

export async function restoreStaffCourseWorkspace(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  ws: StaffCourseWorkspace,
): Promise<void> {
  try {
    await saveState(
      admin,
      telegramId,
      { chatId, messageId: 0 },
      STAFF_COURSE_WORKSPACE_STEP,
      workspacePayload(ws),
    );
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
}

export async function exitStaffCourseWorkspace(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
): Promise<void> {
  await clearStateIfAvailable(admin, telegramId);
  const caps = await loadStaffCapabilities(admin, telegramId);
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: '🎓 Управление курсами\n\nВыберите курс или другой раздел меню.',
    reply_markup: staffGlobalReplyKeyboard(caps),
  });
}

export async function mergeWorkspaceIntoPayload(
  admin: SupabaseClient,
  telegramId: number,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ws = await getStaffCourseWorkspace(admin, telegramId);
  if (!ws) return payload;
  return { ...payload, staffWorkspace: ws, courseId: ws.courseId };
}
