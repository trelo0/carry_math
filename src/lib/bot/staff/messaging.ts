import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { teacherOwnsStudent } from '@/lib/teacher/teacher-access';
import { assertCuratorAssigned } from '@/lib/bot/education/course-homework';

export type StaffMessageRole = 'teacher' | 'curator';

export type StaffMessageRow = {
  id: number;
  staffTelegramId: number;
  studentTelegramId: number;
  staffRole: StaffMessageRole;
  direction: 'student_to_staff' | 'staff_to_student';
  body: string;
  attachmentRef: string | null;
  attachmentKind: 'photo' | 'document' | 'voice' | null;
  staffReadAt: string | null;
  createdAt: string;
};

export type StaffThreadSummary = {
  studentTelegramId: number;
  studentLabel: string;
  unreadCount: number;
  lastBody: string;
  lastAt: string;
};

function isMessagesTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return message.includes('staff_student_messages');
}

export async function resolveMemberChatId(
  admin: SupabaseClient,
  telegramId: number,
): Promise<number | null> {
  const { data, error } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  const chatId = data?.chat_id;
  return typeof chatId === 'number' ? chatId : null;
}

export async function staffStudentLabel(
  admin: SupabaseClient,
  studentTelegramId: number,
): Promise<string> {
  const [{ data: profile }, { data: member }] = await Promise.all([
    admin.from('student_profiles').select('display_name').eq('telegram_id', studentTelegramId).maybeSingle(),
    admin.from('bot_members').select('full_name, phone').eq('telegram_id', studentTelegramId).maybeSingle(),
  ]);
  return (
    (profile?.display_name as string | undefined)?.trim() ||
    (member?.full_name as string | undefined)?.trim() ||
    (member?.phone as string | undefined)?.trim() ||
    `Ученик ${studentTelegramId}`
  );
}

async function assertStaffCanMessageStudent(
  admin: SupabaseClient,
  staffTelegramId: number,
  staffRole: StaffMessageRole,
  studentTelegramId: number,
): Promise<void> {
  if (staffRole === 'teacher') {
    const ok = await teacherOwnsStudent(admin, staffTelegramId, studentTelegramId);
    if (!ok) throw new Error('Нет доступа к этому ученику.');
    return;
  }
  await assertCuratorAssigned(admin, staffTelegramId, studentTelegramId);
}

export async function insertStaffMessage(
  admin: SupabaseClient,
  row: {
    staffTelegramId: number;
    studentTelegramId: number;
    staffRole: StaffMessageRole;
    direction: 'student_to_staff' | 'staff_to_student';
    body: string;
    attachmentRef?: string | null;
    attachmentKind?: 'photo' | 'document' | 'voice' | null;
    markStaffRead?: boolean;
  },
): Promise<boolean> {
  try {
    const { error } = await admin.from('staff_student_messages').insert({
      staff_telegram_id: row.staffTelegramId,
      student_telegram_id: row.studentTelegramId,
      staff_role: row.staffRole,
      direction: row.direction,
      body: row.body,
      attachment_ref: row.attachmentRef ?? null,
      attachment_kind: row.attachmentKind ?? null,
      staff_read_at: row.direction === 'staff_to_student' || row.markStaffRead ? new Date().toISOString() : null,
    });
    if (error) throw error;
    return true;
  } catch (error) {
    if (!isMessagesTableError(error)) throw error;
    return false;
  }
}

export async function deliverStaffToStudent(
  admin: SupabaseClient,
  params: {
    staffTelegramId: number;
    staffRole: StaffMessageRole;
    studentTelegramId: number;
    body: string;
    attachmentRef?: string | null;
    attachmentKind?: 'photo' | 'document' | 'voice' | null;
  },
): Promise<void> {
  await assertStaffCanMessageStudent(
    admin,
    params.staffTelegramId,
    params.staffRole,
    params.studentTelegramId,
  );

  const chatId = await resolveMemberChatId(admin, params.studentTelegramId);
  if (!chatId) {
    throw new Error('У ученика нет chat_id — он ещё не писал боту.');
  }

  const roleLabel = params.staffRole === 'teacher' ? 'преподавателя' : 'куратора';
  const header = `💬 Сообщение от ${roleLabel} District`;
  if (params.body.trim()) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: `${header}\n\n${params.body.trim()}`,
    });
  }

  if (params.attachmentRef?.startsWith('tg:') && params.attachmentKind) {
    const fileId = params.attachmentRef.slice(3);
    if (params.attachmentKind === 'photo') {
      await telegramSend('sendPhoto', { chat_id: chatId, photo: fileId });
    } else if (params.attachmentKind === 'voice') {
      await telegramSend('sendVoice', { chat_id: chatId, voice: fileId });
    } else {
      await telegramSend('sendDocument', { chat_id: chatId, document: fileId });
    }
  }

  await insertStaffMessage(admin, {
    staffTelegramId: params.staffTelegramId,
    studentTelegramId: params.studentTelegramId,
    staffRole: params.staffRole,
    direction: 'staff_to_student',
    body: params.body.trim() || '(вложение)',
    attachmentRef: params.attachmentRef,
    attachmentKind: params.attachmentKind,
  });
}

export async function notifyStaffInboundFromStudent(
  admin: SupabaseClient,
  params: {
    staffTelegramId: number;
    staffRole: StaffMessageRole;
    studentTelegramId: number;
    body: string;
    attachmentRef?: string | null;
    attachmentKind?: 'photo' | 'document' | 'voice' | null;
  },
): Promise<void> {
  await insertStaffMessage(admin, {
    staffTelegramId: params.staffTelegramId,
    studentTelegramId: params.studentTelegramId,
    staffRole: params.staffRole,
    direction: 'student_to_staff',
    body: params.body.trim() || '(вложение)',
    attachmentRef: params.attachmentRef,
    attachmentKind: params.attachmentKind,
  });

  const staffChatId = await resolveMemberChatId(admin, params.staffTelegramId);
  if (!staffChatId) return;

  const label = await staffStudentLabel(admin, params.studentTelegramId);
  const replyCallback =
    params.staffRole === 'teacher'
      ? `t:msg:d:${params.studentTelegramId}`
      : `c:msg:d:${params.studentTelegramId}`;

  await telegramSend('sendMessage', {
    chat_id: staffChatId,
    text: ['💬 Сообщение от ученика', '', `👤 ${label}`, '', params.body.trim() || '📎 Вложение'].join('\n'),
    reply_markup: {
      inline_keyboard: [[{ text: '↩️ Ответить', callback_data: replyCallback }]],
    },
  });

  if (params.attachmentRef?.startsWith('tg:') && params.attachmentKind) {
    const fileId = params.attachmentRef.slice(3);
    if (params.attachmentKind === 'photo') {
      await telegramSend('sendPhoto', { chat_id: staffChatId, photo: fileId });
    } else {
      await telegramSend('sendDocument', { chat_id: staffChatId, document: fileId });
    }
  }
}

function mapRow(raw: Record<string, unknown>): StaffMessageRow {
  return {
    id: raw.id as number,
    staffTelegramId: raw.staff_telegram_id as number,
    studentTelegramId: raw.student_telegram_id as number,
    staffRole: raw.staff_role as StaffMessageRole,
    direction: raw.direction as StaffMessageRow['direction'],
    body: String(raw.body ?? ''),
    attachmentRef: (raw.attachment_ref as string | null) ?? null,
    attachmentKind: (raw.attachment_kind as StaffMessageRow['attachmentKind']) ?? null,
    staffReadAt: (raw.staff_read_at as string | null) ?? null,
    createdAt: raw.created_at as string,
  };
}

export async function listTeacherThreads(
  admin: SupabaseClient,
  teacherTelegramId: number,
  limit = 30,
): Promise<{ threads: StaffThreadSummary[]; storageEnabled: boolean }> {
  return listStaffThreadsForRole(admin, teacherTelegramId, 'teacher', limit);
}

export async function loadThreadMessages(
  admin: SupabaseClient,
  teacherTelegramId: number,
  studentTelegramId: number,
  limit = 25,
): Promise<{ messages: StaffMessageRow[]; storageEnabled: boolean }> {
  try {
    const { data, error } = await admin
      .from('staff_student_messages')
      .select('*')
      .eq('staff_telegram_id', teacherTelegramId)
      .eq('staff_role', 'teacher')
      .eq('student_telegram_id', studentTelegramId)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return { messages: (data ?? []).map((r) => mapRow(r as Record<string, unknown>)), storageEnabled: true };
  } catch (error) {
    if (!isMessagesTableError(error)) throw error;
    return { messages: [], storageEnabled: false };
  }
}

export async function markTeacherThreadRead(
  admin: SupabaseClient,
  teacherTelegramId: number,
  studentTelegramId: number,
): Promise<void> {
  await markStaffThreadRead(admin, teacherTelegramId, 'teacher', studentTelegramId);
}

async function listStaffThreadsForRole(
  admin: SupabaseClient,
  staffTelegramId: number,
  staffRole: StaffMessageRole,
  limit = 30,
): Promise<{ threads: StaffThreadSummary[]; storageEnabled: boolean }> {
  try {
    const { data, error } = await admin
      .from('staff_student_messages')
      .select('student_telegram_id, body, created_at, direction, staff_read_at')
      .eq('staff_telegram_id', staffTelegramId)
      .eq('staff_role', staffRole)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;

    const byStudent = new Map<number, StaffThreadSummary>();
    for (const row of data ?? []) {
      const studentId = row.student_telegram_id as number;
      if (byStudent.has(studentId)) continue;
      const unread = (data ?? []).filter(
        (r) =>
          r.student_telegram_id === studentId &&
          r.direction === 'student_to_staff' &&
          !r.staff_read_at,
      ).length;
      byStudent.set(studentId, {
        studentTelegramId: studentId,
        studentLabel: '',
        unreadCount: unread,
        lastBody: String(row.body ?? ''),
        lastAt: row.created_at as string,
      });
      if (byStudent.size >= limit) break;
    }

    const threads = [...byStudent.values()];
    for (const thread of threads) {
      thread.studentLabel = await staffStudentLabel(admin, thread.studentTelegramId);
    }
    threads.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    return { threads, storageEnabled: true };
  } catch (error) {
    if (!isMessagesTableError(error)) throw error;
    return { threads: [], storageEnabled: false };
  }
}

export async function listCuratorThreads(
  admin: SupabaseClient,
  curatorTelegramId: number,
  limit = 30,
): Promise<{ threads: StaffThreadSummary[]; storageEnabled: boolean }> {
  return listStaffThreadsForRole(admin, curatorTelegramId, 'curator', limit);
}

export async function loadCuratorThreadMessages(
  admin: SupabaseClient,
  curatorTelegramId: number,
  studentTelegramId: number,
  limit = 25,
): Promise<{ messages: StaffMessageRow[]; storageEnabled: boolean }> {
  try {
    const { data, error } = await admin
      .from('staff_student_messages')
      .select('*')
      .eq('staff_telegram_id', curatorTelegramId)
      .eq('staff_role', 'curator')
      .eq('student_telegram_id', studentTelegramId)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return { messages: (data ?? []).map((r) => mapRow(r as Record<string, unknown>)), storageEnabled: true };
  } catch (error) {
    if (!isMessagesTableError(error)) throw error;
    return { messages: [], storageEnabled: false };
  }
}

export async function markStaffThreadRead(
  admin: SupabaseClient,
  staffTelegramId: number,
  staffRole: StaffMessageRole,
  studentTelegramId: number,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    await admin
      .from('staff_student_messages')
      .update({ staff_read_at: now })
      .eq('staff_telegram_id', staffTelegramId)
      .eq('staff_role', staffRole)
      .eq('student_telegram_id', studentTelegramId)
      .eq('direction', 'student_to_staff')
      .is('staff_read_at', null);
  } catch (error) {
    if (!isMessagesTableError(error)) throw error;
  }
}

export async function markCuratorThreadRead(
  admin: SupabaseClient,
  curatorTelegramId: number,
  studentTelegramId: number,
): Promise<void> {
  await markStaffThreadRead(admin, curatorTelegramId, 'curator', studentTelegramId);
}
