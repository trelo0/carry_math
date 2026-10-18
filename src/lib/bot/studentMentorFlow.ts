import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  clearStateIfAvailable,
  getState,
  isConversationStateTableError,
  saveState,
  sendAdminMessage,
  type InlineKeyboard,
} from './admin/core';
import { memberHasRole, loadMemberRoles } from './roles';
import { getStudentCheckStaff, getStudentCurator, getStudentTeacher } from './education/assignments';
import {
  isStudentOnCourse,
  listStudentActiveCourseContexts,
  resolveStudentCourseContext,
} from './education/student-course-context';
import { notifyStaffInboundFromStudent, type StaffMessageRole } from './staff/messaging';
import { notifyAdminsOfSupportMessage } from './studentSupportFlow';

export type StudentMentorContext = 'course' | 'lessons';

const MENTOR_COURSE_PICK_PREFIX = 'm:cr:';

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

type MentorQuestionOptions = {
  homework?: boolean;
  context?: StudentMentorContext;
  courseSlug?: string | null;
  courseId?: number | null;
};

async function resolveCourseIdForMentorQuestion(
  admin: SupabaseClient,
  telegramId: number,
  options: MentorQuestionOptions,
): Promise<number | null> {
  const context = options.context ?? 'lessons';
  const needsCourse = context === 'course' || options.homework;
  if (!needsCourse) return options.courseId ?? null;

  if (options.courseId != null) return options.courseId;

  if (options.courseSlug) {
    const ctx = await resolveStudentCourseContext(admin, telegramId, options.courseSlug);
    return ctx?.courseId ?? null;
  }

  const enrollments = await listStudentActiveCourseContexts(admin, telegramId);
  if (enrollments.length === 1) return enrollments[0]!.courseId;
  if (enrollments.length === 0) {
    const ctx = await resolveStudentCourseContext(admin, telegramId, null);
    return ctx?.courseId ?? null;
  }
  return null;
}

async function promptCoursePickerForMentor(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  options: MentorQuestionOptions,
): Promise<void> {
  const enrollments = await listStudentActiveCourseContexts(admin, telegramId);
  const context = options.context ?? 'lessons';
  const purpose =
    options.homework
      ? 'сдать домашку'
      : context === 'course'
        ? 'задать вопрос по курсу'
        : 'написать наставнику';

  try {
    await saveState(admin, telegramId, { chatId, messageId: 0 }, 'student:mentor-pick', {
      homework: options.homework ?? false,
      mentorContext: context,
    });
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  const keyboard: InlineKeyboard = {
    inline_keyboard: [
      ...enrollments.map((c) => [
        {
          text: c.title.slice(0, 58),
          callback_data: `${MENTOR_COURSE_PICK_PREFIX}${c.courseId}`,
        },
      ]),
      [{ text: '⬅️ Отмена', callback_data: 'm:cr:cancel' }],
    ],
  };

  await sendAdminMessage(
    chatId,
    `🎓 Вы на нескольких курсах.\n\nВыберите курс, чтобы ${purpose}:\n\n` +
      'Сообщение не будет отправлено, пока курс не выбран.',
    keyboard,
  );
}

async function finalizeMentorQuestionStart(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  options: MentorQuestionOptions & { courseId: number | null },
): Promise<void> {
  const context = options.context ?? 'lessons';
  const courseId = options.courseId;

  const mentorCourseOpts = courseId != null ? { courseId } : undefined;
  const teacher = await getStudentTeacher(admin, telegramId, mentorCourseOpts);
  const curator = await getStudentCurator(admin, telegramId, mentorCourseOpts);
  const checker =
    courseId != null ? await getStudentCheckStaff(admin, telegramId, courseId) : null;

  let mentor = teacher;
  let staffRole: StaffMessageRole | undefined;

  const preferCheck = context === 'course' || options.homework;

  if (preferCheck && checker) {
    mentor = checker;
    staffRole = 'check';
  } else if (context === 'course') {
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
      courseId: courseId ?? undefined,
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
    staffRole === 'check'
      ? 'проверяющему ДЗ'
      : staffRole === 'curator'
        ? 'куратору курса'
        : staffRole === 'teacher'
          ? 'преподавателю'
          : 'наставнику';

  const intro = options.homework
    ? `📝 Сдать домашку${courseId != null ? ' (онлайн-курс)' : ''}\n\nНаставник: ${mentor.fullName ?? roleHint}\n\n`
    : `💬 Вопрос ${context === 'course' ? 'по курсу' : 'наставнику'}\n\n${mentor.fullName ?? 'Наставник'}\n\n`;

  await sendAdminMessage(
    chatId,
    intro +
      'Отправьте текст, фото или документ одним сообщением.\n\n' +
      '⬅️ Отмена — «Отмена».',
  );
}

export async function beginStudentMentorQuestion(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  options: MentorQuestionOptions = {},
): Promise<void> {
  const context = options.context ?? 'lessons';
  const needsCourse = context === 'course' || options.homework;

  if (needsCourse && options.courseId == null && !options.courseSlug) {
    const enrollments = await listStudentActiveCourseContexts(admin, telegramId);
    if (enrollments.length > 1) {
      await promptCoursePickerForMentor(admin, telegramId, chatId, options);
      return;
    }
  }

  const courseId = await resolveCourseIdForMentorQuestion(admin, telegramId, options);
  await finalizeMentorQuestionStart(admin, telegramId, chatId, { ...options, courseId });
}

export async function handleStudentMentorCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!data.startsWith(MENTOR_COURSE_PICK_PREFIX)) return false;

  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }

  if (data === 'm:cr:cancel') {
    await clearStateIfAvailable(admin, telegramId);
    await sendAdminMessage(chatId, 'Выбор курса отменён.');
    return true;
  }

  const courseId = Number(data.slice(MENTOR_COURSE_PICK_PREFIX.length));
  if (!Number.isFinite(courseId)) return true;

  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return true;
  }
  if (!state || state.step !== 'student:mentor-pick') {
    await sendAdminMessage(chatId, 'Сессия выбора курса устарела. Начните снова из меню.');
    return true;
  }

  const onCourse = await isStudentOnCourse(admin, telegramId, courseId);
  if (!onCourse) {
    await sendAdminMessage(chatId, 'Нет доступа к этому курсу.');
    return true;
  }

  const payload = state.payload;
  await clearStateIfAvailable(admin, telegramId);
  await finalizeMentorQuestionStart(admin, telegramId, chatId, {
    homework: Boolean(payload.homework),
    context: (payload.mentorContext as StudentMentorContext | undefined) ?? 'course',
    courseId,
  });
  return true;
}

async function resolveStaffRoleForMentor(
  admin: SupabaseClient,
  mentorTelegramId: number,
  staffRoleOverride?: StaffMessageRole,
): Promise<StaffMessageRole | null> {
  if (staffRoleOverride) return staffRoleOverride;
  const roles = await loadMemberRoles(admin, mentorTelegramId);
  if (memberHasRole(roles, 'teacher')) return 'teacher';
  if (memberHasRole(roles, 'check')) return 'check';
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
  courseId?: number,
): Promise<'mentor' | 'support'> {
  if (!mentorTelegramId) return 'support';

  const mentorChatId = await resolveMentorChatId(admin, mentorTelegramId);
  if (!mentorChatId) return 'support';

  const staffRole = await resolveStaffRoleForMentor(admin, mentorTelegramId, staffRoleOverride);
  if (!staffRole) return 'support';

  await notifyStaffInboundFromStudent(admin, {
    staffTelegramId: mentorTelegramId,
    staffRole,
    studentTelegramId,
    body,
    attachmentRef: attachment?.ref,
    attachmentKind: attachment?.kind,
    courseId,
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

  if (state?.step === 'student:mentor-pick') {
    const trimmed = text.trim();
    if (/^отмена$/i.test(trimmed)) {
      await clearStateIfAvailable(admin, telegramId);
      await sendAdminMessage(chatId, 'Выбор курса отменён.');
      return true;
    }
    await sendAdminMessage(chatId, 'Выберите курс кнопкой выше или напишите «Отмена».');
    return true;
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
  const courseId = state.payload.courseId as number | undefined;

  if (staffRole === 'check' && courseId == null) {
    await sendAdminMessage(
      chatId,
      'Не удалось определить курс для сообщения. Начните снова из раздела курса.',
    );
    await clearStateIfAvailable(admin, telegramId);
    return true;
  }

  const target = await forwardToMentor(admin, telegramId, mentorTelegramId, trimmed, staffRole, undefined, courseId);
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
  if (state?.step === 'student:mentor-pick') {
    await sendAdminMessage(chatId, 'Сначала выберите курс кнопкой выше.');
    return true;
  }
  if (!state || state.step !== 'student:mentor') return false;

  const mentorTelegramId = state.payload.mentorTelegramId as number | undefined;
  const staffRole = state.payload.staffRole as StaffMessageRole | undefined;
  const courseId = state.payload.courseId as number | undefined;
  const body = caption.trim() ? caption.trim() : 'Вложение';

  if (staffRole === 'check' && courseId == null) {
    await clearStateIfAvailable(admin, telegramId);
    await sendAdminMessage(chatId, 'Не удалось определить курс. Начните снова.');
    return true;
  }

  const target = await forwardToMentor(admin, telegramId, mentorTelegramId, body, staffRole, {
    ref: `tg:${attachment.fileId}`,
    kind: attachment.kind,
  }, courseId);
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
