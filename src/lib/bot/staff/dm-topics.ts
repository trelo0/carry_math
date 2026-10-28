import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { assertHomeworkCheckerAssigned } from '@/lib/bot/education/course-homework';
import { staffHasCourseAccess } from '@/lib/bot/education/course-staff';
import { isStudentOnCourse } from '@/lib/bot/education/student-course-context';
import { hasFullStaffPreview, isAdminEnv, loadMemberRoles, memberHasRole } from '@/lib/bot/roles';
import { sendTelegramFileById } from '@/lib/bot/studentHomeworkFlow';
import { guardStaffToStudentMessage } from '@/lib/bot/moderation';
import { insertStaffMessage, resolveMemberChatId, staffStudentLabel, type StaffMessageRole } from './messaging';

export type DmTopicStaffRole = 'check' | 'admin' | 'curator';

export type StaffDmTopicRow = {
  id: number;
  staffTelegramId: number;
  studentTelegramId: number;
  staffRole: DmTopicStaffRole;
  messageThreadId: number;
  topicName: string;
};

function isTopicsTableError(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error);
  const code = String((error as { code?: unknown })?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return message.includes('staff_dm_topics');
}

export function staffDmTopicsEnabled(): boolean {
  const v = process.env.STAFF_DM_TOPICS_ENABLED?.trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off') return false;
  return true;
}

/** Deep-link в topic личного чата с ботом (Forum Topics). */
export function botPrivateTopicUrl(messageThreadId: number): string | null {
  const raw = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '');
  if (!raw || !Number.isFinite(messageThreadId) || messageThreadId <= 0) return null;
  return `https://t.me/${raw}/${messageThreadId}`;
}

export function usesStaffDmTopics(staffRole: StaffMessageRole | DmTopicStaffRole): boolean {
  if (!staffDmTopicsEnabled()) return false;
  return staffRole === 'check' || staffRole === 'admin' || staffRole === 'curator';
}

function mapTopicRow(raw: Record<string, unknown>): StaffDmTopicRow {
  return {
    id: raw.id as number,
    staffTelegramId: raw.staff_telegram_id as number,
    studentTelegramId: raw.student_telegram_id as number,
    staffRole: raw.staff_role as DmTopicStaffRole,
    messageThreadId: raw.message_thread_id as number,
    topicName: String(raw.topic_name ?? ''),
  };
}

function topicNameForStudent(label: string): string {
  const trimmed = label.trim().slice(0, 120);
  return trimmed || 'Ученик';
}

async function sendToTopic(
  staffChatId: number,
  messageThreadId: number,
  payload: { text?: string; photo?: string; document?: string; voice?: string; caption?: string },
): Promise<{ ok: boolean; description?: string }> {
  const thread = { chat_id: staffChatId, message_thread_id: messageThreadId };
  if (payload.photo) {
    return telegramSend('sendPhoto', {
      ...thread,
      photo: payload.photo,
      caption: payload.caption,
    });
  }
  if (payload.document) {
    return telegramSend('sendDocument', {
      ...thread,
      document: payload.document,
      caption: payload.caption,
    });
  }
  if (payload.voice) {
    return telegramSend('sendVoice', {
      ...thread,
      voice: payload.voice,
      caption: payload.caption,
    });
  }
  return telegramSend('sendMessage', {
    ...thread,
    text: payload.text ?? '',
  });
}

export async function listAdminTelegramIdsForTopics(
  admin: SupabaseClient,
): Promise<number[]> {
  const envIds = (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const roleFilter = envIds.length
    ? `role.eq.admin,telegram_id.in.(${envIds.join(',')})`
    : 'role.eq.admin';

  const { data, error } = await admin
    .from('bot_members')
    .select('telegram_id')
    .or(roleFilter);
  if (error) throw error;
  const ids = new Set<number>();
  for (const row of data ?? []) {
    const id = (row as { telegram_id: number }).telegram_id;
    if (typeof id === 'number') ids.add(id);
  }
  for (const raw of envIds) {
    const id = Number(raw);
    if (Number.isFinite(id)) ids.add(id);
  }
  return [...ids];
}

export async function assertCheckerCanReachStudent(
  admin: SupabaseClient,
  checkerTelegramId: number,
  studentTelegramId: number,
  courseIdHint?: number | null,
): Promise<void> {
  if (courseIdHint != null) {
    await assertHomeworkCheckerAssigned(admin, checkerTelegramId, studentTelegramId, {
      courseId: courseIdHint,
    });
    return;
  }
  const roles = await loadMemberRoles(admin, checkerTelegramId);
  if (hasFullStaffPreview(roles, checkerTelegramId)) return;

  const { data: enrollments, error } = await admin
    .from('course_enrollments')
    .select('course_id')
    .eq('telegram_id', studentTelegramId)
    .eq('status', 'active');
  if (error) throw error;
  for (const row of enrollments ?? []) {
    const courseId = row.course_id as number;
    if (await staffHasCourseAccess(admin, checkerTelegramId, courseId, 'check')) {
      if (await isStudentOnCourse(admin, studentTelegramId, courseId)) return;
    }
  }
  throw new Error('Нет доступа к этому ученику как проверяющему.');
}

export async function assertAdminCanReachStudent(
  admin: SupabaseClient,
  adminTelegramId: number,
  _studentTelegramId: number,
): Promise<void> {
  if (isAdminEnv(adminTelegramId)) return;
  const roles = await loadMemberRoles(admin, adminTelegramId);
  if (memberHasRole(roles, 'admin') || hasFullStaffPreview(roles, adminTelegramId)) return;
  throw new Error('Нет прав администратора для переписки с учеником.');
}

export async function assertCuratorCanReachStudent(
  admin: SupabaseClient,
  curatorTelegramId: number,
  studentTelegramId: number,
  courseIdHint?: number | null,
): Promise<void> {
  const roles = await loadMemberRoles(admin, curatorTelegramId);
  if (hasFullStaffPreview(roles, curatorTelegramId)) return;

  if (courseIdHint != null) {
    if (!(await staffHasCourseAccess(admin, curatorTelegramId, courseIdHint, 'curator'))) {
      throw new Error('Нет доступа к этому курсу как куратору.');
    }
    if (!(await isStudentOnCourse(admin, studentTelegramId, courseIdHint))) {
      throw new Error('Ученик не на этом курсе.');
    }
    return;
  }

  const { data: enrollments, error } = await admin
    .from('course_enrollments')
    .select('course_id')
    .eq('telegram_id', studentTelegramId)
    .eq('status', 'active');
  if (error) throw error;
  for (const row of enrollments ?? []) {
    const courseId = row.course_id as number;
    if (await staffHasCourseAccess(admin, curatorTelegramId, courseId, 'curator')) {
      if (await isStudentOnCourse(admin, studentTelegramId, courseId)) return;
    }
  }
  throw new Error('Нет доступа к этому ученику как куратору.');
}

export async function resolveStaffDmTopicByThread(
  admin: SupabaseClient,
  staffTelegramId: number,
  messageThreadId: number,
): Promise<StaffDmTopicRow | null> {
  try {
    const { data, error } = await admin
      .from('staff_dm_topics')
      .select('*')
      .eq('staff_telegram_id', staffTelegramId)
      .eq('message_thread_id', messageThreadId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapTopicRow(data as Record<string, unknown>);
  } catch (error) {
    if (isTopicsTableError(error)) return null;
    throw error;
  }
}

export async function ensureStaffDmTopic(
  admin: SupabaseClient,
  params: {
    staffTelegramId: number;
    studentTelegramId: number;
    staffRole: DmTopicStaffRole;
    courseIdHint?: number | null;
  },
): Promise<StaffDmTopicRow | null> {
  if (!usesStaffDmTopics(params.staffRole)) return null;

  if (params.staffRole === 'check') {
    await assertCheckerCanReachStudent(
      admin,
      params.staffTelegramId,
      params.studentTelegramId,
      params.courseIdHint,
    );
  } else if (params.staffRole === 'curator') {
    await assertCuratorCanReachStudent(
      admin,
      params.staffTelegramId,
      params.studentTelegramId,
      params.courseIdHint,
    );
  } else {
    await assertAdminCanReachStudent(admin, params.staffTelegramId, params.studentTelegramId);
  }

  try {
    const { data: existing, error: loadError } = await admin
      .from('staff_dm_topics')
      .select('*')
      .eq('staff_telegram_id', params.staffTelegramId)
      .eq('student_telegram_id', params.studentTelegramId)
      .eq('status', 'active')
      .maybeSingle();
    if (loadError) throw loadError;
    if (existing?.message_thread_id) {
      return mapTopicRow(existing as Record<string, unknown>);
    }

    const label = await staffStudentLabel(admin, params.studentTelegramId);
    const name = topicNameForStudent(label);
    const staffChatId =
      (await resolveMemberChatId(admin, params.staffTelegramId)) ?? params.staffTelegramId;

    const created = await telegramSend('createForumTopic', {
      chat_id: staffChatId,
      name,
    });
    if (!created.ok || !created.result) {
      throw new Error(created.description ?? 'Не удалось создать тему в Telegram.');
    }
    const threadId = (created.result as { message_thread_id?: number }).message_thread_id;
    if (typeof threadId !== 'number') {
      throw new Error('Telegram не вернул message_thread_id для темы.');
    }

    const row = {
      staff_telegram_id: params.staffTelegramId,
      student_telegram_id: params.studentTelegramId,
      staff_role: params.staffRole,
      message_thread_id: threadId,
      topic_name: name,
      status: 'active',
      updated_at: new Date().toISOString(),
    };

    const { data: inserted, error: insertError } = await admin
      .from('staff_dm_topics')
      .upsert(row, { onConflict: 'staff_telegram_id,student_telegram_id' })
      .select('*')
      .maybeSingle();

    if (insertError) {
      if (String(insertError.message).includes('duplicate') || insertError.code === '23505') {
        const { data: again } = await admin
          .from('staff_dm_topics')
          .select('*')
          .eq('staff_telegram_id', params.staffTelegramId)
          .eq('student_telegram_id', params.studentTelegramId)
          .eq('status', 'active')
          .maybeSingle();
        if (again) return mapTopicRow(again as Record<string, unknown>);
      }
      throw insertError;
    }
    if (inserted) return mapTopicRow(inserted as Record<string, unknown>);

    return {
      id: 0,
      staffTelegramId: params.staffTelegramId,
      studentTelegramId: params.studentTelegramId,
      staffRole: params.staffRole,
      messageThreadId: threadId,
      topicName: name,
    };
  } catch (error) {
    if (isTopicsTableError(error)) return null;
    throw error;
  }
}

export async function openStaffStudentDmTopic(
  admin: SupabaseClient,
  params: {
    staffTelegramId: number;
    studentTelegramId: number;
    staffRole: DmTopicStaffRole;
    courseIdHint?: number | null;
    introText?: string;
  },
): Promise<{ ok: boolean; error?: string; messageThreadId?: number }> {
  try {
    const topic = await ensureStaffDmTopic(admin, params);
    if (!topic) {
      return { ok: false, error: 'Topics недоступны (миграция или STAFF_DM_TOPICS_ENABLED).' };
    }
    const staffChatId =
      (await resolveMemberChatId(admin, params.staffTelegramId)) ?? params.staffTelegramId;
    const label = await staffStudentLabel(admin, params.studentTelegramId);
    const intro =
      params.introText ??
      `✉️ Диалог с ${label}\n\nСообщения ученика будут здесь. Ответьте в этой теме — ученик получит ответ в боте.`;
    const sent = await sendToTopic(staffChatId, topic.messageThreadId, { text: intro });
    if (!sent.ok) {
      return { ok: false, error: sent.description ?? 'Не удалось отправить сообщение в тему.' };
    }
    return { ok: true, messageThreadId: topic.messageThreadId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Ошибка открытия темы.' };
  }
}

export async function deliverInboundToStaffTopic(
  admin: SupabaseClient,
  params: {
    staffTelegramId: number;
    staffRole: DmTopicStaffRole;
    studentTelegramId: number;
    body: string;
    attachmentRef?: string | null;
    attachmentKind?: 'photo' | 'document' | 'voice' | null;
    courseIdHint?: number | null;
    header?: string;
    contextIntro?: string;
    plain?: boolean;
  },
): Promise<boolean> {
  if (!usesStaffDmTopics(params.staffRole)) return false;

  const topic = await ensureStaffDmTopic(admin, {
    staffTelegramId: params.staffTelegramId,
    studentTelegramId: params.studentTelegramId,
    staffRole: params.staffRole,
    courseIdHint: params.courseIdHint,
  });
  if (!topic) return false;

  await insertStaffMessage(admin, {
    staffTelegramId: params.staffTelegramId,
    studentTelegramId: params.studentTelegramId,
    staffRole: params.staffRole,
    direction: 'student_to_staff',
    body: params.body.trim() || '(вложение)',
    attachmentRef: params.attachmentRef,
    attachmentKind: params.attachmentKind,
    courseId: params.courseIdHint ?? null,
    markStaffRead: false,
  });

  const staffChatId =
    (await resolveMemberChatId(admin, params.staffTelegramId)) ?? params.staffTelegramId;
  const label = await staffStudentLabel(admin, params.studentTelegramId);
  const bodyText = params.body.trim() || '(вложение)';

  if (params.contextIntro?.trim()) {
    await sendToTopic(staffChatId, topic.messageThreadId, {
      text: params.contextIntro.trim(),
    });
  }

  const textBlock = params.plain
    ? bodyText
    : [params.header ?? '💬 Сообщение от ученика', '', `👤 ${label}`, '', bodyText].join('\n');

  const ref = params.attachmentRef?.trim() ?? '';
  const fileId = ref.startsWith('tg:') ? ref.slice(3) : null;

  if (fileId && params.attachmentKind) {
    await sendToTopic(staffChatId, topic.messageThreadId, {
      ...(params.attachmentKind === 'photo'
        ? { photo: fileId }
        : params.attachmentKind === 'voice'
          ? { voice: fileId }
          : { document: fileId }),
      caption: textBlock.slice(0, 1024),
    });
  } else {
    await sendToTopic(staffChatId, topic.messageThreadId, { text: textBlock });
  }
  return true;
}

export async function deliverStaffTopicReplyToStudent(
  admin: SupabaseClient,
  topic: StaffDmTopicRow,
  params: {
    body: string;
    attachmentRef?: string | null;
    attachmentKind?: 'photo' | 'document' | 'voice' | null;
    telegramMessageId?: number;
  },
): Promise<{ ok: boolean; error?: string }> {
  const staffRole = topic.staffRole;
  if (staffRole === 'check') {
    await assertCheckerCanReachStudent(admin, topic.staffTelegramId, topic.studentTelegramId);
  } else if (staffRole === 'curator') {
    await assertCuratorCanReachStudent(admin, topic.staffTelegramId, topic.studentTelegramId);
  } else {
    await assertAdminCanReachStudent(admin, topic.staffTelegramId, topic.studentTelegramId);
  }

  const staffChatId =
    (await resolveMemberChatId(admin, topic.staffTelegramId)) ?? topic.staffTelegramId;
  const trimmed = params.body.trim();
  if (trimmed) {
    const guard = await guardStaffToStudentMessage(admin, {
      staffTelegramId: topic.staffTelegramId,
      staffChatId,
      studentTelegramId: topic.studentTelegramId,
      text: trimmed,
      staffRole:
        staffRole === 'admin' ? 'admin' : staffRole === 'curator' ? 'curator' : 'check',
    });
    if (guard.blocked) {
      return { ok: false, error: 'Сообщение не отправлено: обнаружены личные контактные данные.' };
    }
  }

  const studentChatId = await resolveMemberChatId(admin, topic.studentTelegramId);
  if (!studentChatId) {
    return { ok: false, error: 'У ученика нет chat_id — он ещё не писал боту.' };
  }

  await insertStaffMessage(admin, {
    staffTelegramId: topic.staffTelegramId,
    studentTelegramId: topic.studentTelegramId,
    staffRole,
    direction: 'staff_to_student',
    body: trimmed || '(вложение)',
    attachmentRef: params.attachmentRef,
    attachmentKind: params.attachmentKind,
    markStaffRead: true,
  });

  const roleLabel =
    staffRole === 'admin'
      ? 'администрации'
      : staffRole === 'check'
        ? 'проверяющего ДЗ'
        : 'куратора курса';
  const ref = params.attachmentRef?.trim() ?? '';
  const fileId = ref.startsWith('tg:') ? ref.slice(3) : null;

  if (fileId && params.attachmentKind) {
    const cap = trimmed ? `💬 Сообщение от ${roleLabel}:\n\n${trimmed}` : `💬 Вложение от ${roleLabel}`;
    const fileRes = await sendTelegramFileById(studentChatId, fileId, params.attachmentKind);
    if (!fileRes.ok) {
      return { ok: false, error: fileRes.description ?? 'Не удалось отправить вложение.' };
    }
    if (trimmed) {
      await telegramSend('sendMessage', {
        chat_id: studentChatId,
        text: cap,
      });
    }
    return { ok: true };
  }

  const result = await telegramSend('sendMessage', {
    chat_id: studentChatId,
    text: `💬 Сообщение от ${roleLabel}:\n\n${trimmed || '(без текста)'}`,
  });
  if (!result.ok) {
    return { ok: false, error: result.description ?? 'Не удалось отправить сообщение.' };
  }
  return { ok: true };
}

export async function notifyAllAdminsInStudentTopics(
  admin: SupabaseClient,
  studentTelegramId: number,
  body: string,
  header?: string,
): Promise<void> {
  if (!staffDmTopicsEnabled()) return;
  const adminIds = await listAdminTelegramIdsForTopics(admin);
  await Promise.all(
    adminIds.map((staffTelegramId) =>
      deliverInboundToStaffTopic(admin, {
        staffTelegramId,
        staffRole: 'admin',
        studentTelegramId,
        body,
        header,
      }).catch(() => undefined),
    ),
  );
}

export async function tryClaimTelegramUpdate(
  admin: SupabaseClient,
  updateId: number | undefined,
): Promise<boolean> {
  if (updateId == null || !Number.isFinite(updateId)) return true;
  try {
    const { error } = await admin.from('telegram_processed_updates').insert({ update_id: updateId });
    if (error) {
      if (error.code === '23505') return false;
      if (String(error.message).includes('telegram_processed_updates')) return true;
      throw error;
    }
    return true;
  } catch (error) {
    if (String(error).includes('telegram_processed_updates')) return true;
    throw error;
  }
}
