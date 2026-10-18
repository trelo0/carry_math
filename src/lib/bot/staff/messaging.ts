import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { teacherOwnsStudent } from '@/lib/teacher/teacher-access';
import { assertCuratorAssigned } from '@/lib/bot/education/course-homework';
import { guardStaffToStudentMessage } from '@/lib/bot/moderation';

export type StaffMessageRole = 'teacher' | 'curator' | 'check';

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

function isCourseIdColumnError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error);
  return message.includes('course_id');
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
  courseId?: number | null,
): Promise<void> {
  if (staffRole === 'teacher') {
    const ok = await teacherOwnsStudent(admin, staffTelegramId, studentTelegramId);
    if (!ok) throw new Error('Нет доступа к этому ученику.');
    return;
  }
  if (staffRole === 'check') {
    const { assertHomeworkCheckerAssigned } = await import('@/lib/bot/education/course-homework');
    if (courseId == null) {
      throw new Error('Укажите курс для переписки с учеником.');
    }
    await assertHomeworkCheckerAssigned(admin, staffTelegramId, studentTelegramId, { courseId });
    return;
  }
  await assertCuratorAssigned(admin, staffTelegramId, studentTelegramId, { courseId });
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
    courseId?: number | null;
  },
): Promise<boolean> {
  const base = {
    staff_telegram_id: row.staffTelegramId,
    student_telegram_id: row.studentTelegramId,
    staff_role: row.staffRole,
    direction: row.direction,
    body: row.body,
    attachment_ref: row.attachmentRef ?? null,
    attachment_kind: row.attachmentKind ?? null,
    staff_read_at: row.direction === 'staff_to_student' || row.markStaffRead ? new Date().toISOString() : null,
  };
  try {
    const payload =
      row.courseId != null ? { ...base, course_id: row.courseId } : base;
    let { error } = await admin.from('staff_student_messages').insert(payload);
    if (error && row.courseId != null && isCourseIdColumnError(error)) {
      ({ error } = await admin.from('staff_student_messages').insert(base));
    }
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
    courseId?: number | null;
  },
): Promise<void> {
  await assertStaffCanMessageStudent(
    admin,
    params.staffTelegramId,
    params.staffRole,
    params.studentTelegramId,
    params.courseId,
  );

  const staffChatId = await resolveMemberChatId(admin, params.staffTelegramId);
  if (params.body.trim()) {
    const guard = await guardStaffToStudentMessage(admin, {
      staffTelegramId: params.staffTelegramId,
      staffChatId: staffChatId ?? params.staffTelegramId,
      studentTelegramId: params.studentTelegramId,
      text: params.body.trim(),
      staffRole: params.staffRole,
    });
    if (guard.blocked) {
      throw new Error('Сообщение не отправлено: обнаружены личные контактные данные.');
    }
  }

  const chatId = await resolveMemberChatId(admin, params.studentTelegramId);
  if (!chatId) {
    throw new Error('У ученика нет chat_id — он ещё не писал боту.');
  }

  const roleLabel =
    params.staffRole === 'teacher'
      ? 'преподавателя'
      : params.staffRole === 'check'
        ? 'проверяющего'
        : 'куратора';
  const header = `💬 Сообщение от ${roleLabel} District`;
  const { studentNotifyKeyboard } = await import('@/lib/bot/student-push-notify');
  if (params.body.trim()) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: `${header}\n\n${params.body.trim()}`,
      reply_markup: studentNotifyKeyboard(),
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
    courseId: params.courseId,
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
    courseId?: number | null;
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
    courseId: params.courseId,
  });

  const staffChatId = await resolveMemberChatId(admin, params.staffTelegramId);
  if (!staffChatId) return;

  const label = await staffStudentLabel(admin, params.studentTelegramId);
  let courseLine = '';
  if (params.courseId != null) {
    const { data: courseRow } = await admin
      .from('courses')
      .select('title')
      .eq('id', params.courseId)
      .maybeSingle();
    const title = (courseRow?.title as string | undefined)?.trim();
    if (title) courseLine = `\n🎓 ${title}`;
  }
  const replyCallback =
    params.staffRole === 'teacher'
      ? `t:msg:d:${params.studentTelegramId}`
      : params.staffRole === 'check'
        ? `k:msg:${params.courseId ?? 0}:d:${params.studentTelegramId}`
        : `c:msg:d:${params.studentTelegramId}`;

  const isCheck = params.staffRole === 'check';
  await telegramSend('sendMessage', {
    chat_id: staffChatId,
    text: ['💬 Сообщение от ученика', '', `👤 ${label}${courseLine}`, '', params.body.trim() || '📎 Вложение'].join('\n'),
    reply_markup: {
      inline_keyboard: isCheck
        ? [
            [
              { text: 'Закрыть', callback_data: 'k:ntf:close' },
              { text: 'Показать', callback_data: replyCallback },
            ],
          ]
        : [[{ text: '↩️ Ответить', callback_data: replyCallback }]],
    },
  });

  if (!isCheck && params.attachmentRef?.startsWith('tg:') && params.attachmentKind) {
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

export async function listCheckThreadsForCourse(
  admin: SupabaseClient,
  checkTelegramId: number,
  courseId: number,
  studentTelegramIds: number[],
  limit = 30,
): Promise<{ threads: StaffThreadSummary[]; storageEnabled: boolean }> {
  const allowed = new Set(studentTelegramIds);
  try {
    let q = admin
      .from('staff_student_messages')
      .select('student_telegram_id, body, created_at, direction, staff_read_at, course_id')
      .eq('staff_telegram_id', checkTelegramId)
      .eq('staff_role', 'check')
      .order('created_at', { ascending: false })
      .limit(500);
    const { data, error } = await q;
    if (error) throw error;

    const rows = (data ?? []).filter((row) => {
      const tg = row.student_telegram_id as number;
      if (!allowed.has(tg)) return false;
      const cid = row.course_id as number | null | undefined;
      if (cid == null) return true;
      return cid === courseId;
    });

    const byStudent = new Map<number, StaffThreadSummary>();
    for (const row of rows) {
      const studentId = row.student_telegram_id as number;
      if (byStudent.has(studentId)) continue;
      const unread = rows.filter(
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

export async function loadCheckThreadMessages(
  admin: SupabaseClient,
  checkTelegramId: number,
  studentTelegramId: number,
  courseId?: number | null,
  limit = 25,
): Promise<{ messages: StaffMessageRow[]; storageEnabled: boolean }> {
  try {
    let q = admin
      .from('staff_student_messages')
      .select('*')
      .eq('staff_telegram_id', checkTelegramId)
      .eq('staff_role', 'check')
      .eq('student_telegram_id', studentTelegramId)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (courseId != null) {
      q = q.or(`course_id.eq.${courseId},course_id.is.null`);
    }
    const { data, error } = await q;
    if (error) {
      if (courseId != null && isCourseIdColumnError(error)) {
        const fallback = await admin
          .from('staff_student_messages')
          .select('*')
          .eq('staff_telegram_id', checkTelegramId)
          .eq('staff_role', 'check')
          .eq('student_telegram_id', studentTelegramId)
          .order('created_at', { ascending: true })
          .limit(limit);
        if (fallback.error) throw fallback.error;
        return {
          messages: (fallback.data ?? []).map((r) => mapRow(r as Record<string, unknown>)),
          storageEnabled: true,
        };
      }
      throw error;
    }
    return { messages: (data ?? []).map((r) => mapRow(r as Record<string, unknown>)), storageEnabled: true };
  } catch (error) {
    if (!isMessagesTableError(error)) throw error;
    return { messages: [], storageEnabled: false };
  }
}

export async function markCheckThreadRead(
  admin: SupabaseClient,
  checkTelegramId: number,
  studentTelegramId: number,
  courseId?: number | null,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    let q = admin
      .from('staff_student_messages')
      .update({ staff_read_at: now })
      .eq('staff_telegram_id', checkTelegramId)
      .eq('staff_role', 'check')
      .eq('student_telegram_id', studentTelegramId)
      .eq('direction', 'student_to_staff')
      .is('staff_read_at', null);
    if (courseId != null) {
      q = q.or(`course_id.eq.${courseId},course_id.is.null`);
    }
    await q;
  } catch (error) {
    if (!isMessagesTableError(error)) throw error;
  }
}

export type StudentStaffThreadSummary = {
  staffTelegramId: number;
  staffRole: StaffMessageRole;
  lastBody: string;
  lastAt: string;
  lastDirection: 'student_to_staff' | 'staff_to_student';
  waitingReply: boolean;
};

export async function listStudentCourseStaffThreads(
  admin: SupabaseClient,
  studentTelegramId: number,
  courseId: number,
  limit = 15,
): Promise<{ threads: StudentStaffThreadSummary[]; storageEnabled: boolean }> {
  try {
    const { data, error } = await admin
      .from('staff_student_messages')
      .select('staff_telegram_id, staff_role, body, created_at, direction')
      .eq('student_telegram_id', studentTelegramId)
      .eq('course_id', courseId)
      .in('staff_role', ['check', 'curator'])
      .order('created_at', { ascending: false })
      .limit(400);
    if (error && isCourseIdColumnError(error)) {
      const fallback = await admin
        .from('staff_student_messages')
        .select('staff_telegram_id, staff_role, body, created_at, direction')
        .eq('student_telegram_id', studentTelegramId)
        .in('staff_role', ['check', 'curator'])
        .order('created_at', { ascending: false })
        .limit(400);
      if (fallback.error) throw fallback.error;
      return summarizeStudentThreads(fallback.data ?? [], limit);
    }
    if (error) throw error;
    return summarizeStudentThreads(data ?? [], limit);
  } catch (error) {
    if (!isMessagesTableError(error)) throw error;
    return { threads: [], storageEnabled: false };
  }
}

function summarizeStudentThreads(
  rows: Array<Record<string, unknown>>,
  limit: number,
): { threads: StudentStaffThreadSummary[]; storageEnabled: true } {
  const byStaff = new Map<string, StudentStaffThreadSummary>();
  for (const row of rows) {
    const staffTelegramId = row.staff_telegram_id as number;
    const staffRole = row.staff_role as StaffMessageRole;
    const key = `${staffRole}:${staffTelegramId}`;
    if (byStaff.has(key)) continue;
    const direction = row.direction as 'student_to_staff' | 'staff_to_student';
    byStaff.set(key, {
      staffTelegramId,
      staffRole,
      lastBody: String(row.body ?? ''),
      lastAt: row.created_at as string,
      lastDirection: direction,
      waitingReply: direction === 'student_to_staff',
    });
    if (byStaff.size >= limit) break;
  }
  const threads = [...byStaff.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return { threads, storageEnabled: true };
}
