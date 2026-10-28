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
  listStudentPurchasedVisibleCourseContexts,
  resolveStudentCourseContext,
} from './education/student-course-context';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';
import { syncCourseStaffFromContent } from './education/course-staff';
import { notifyStaffInboundFromStudent, type StaffMessageRole } from './staff/messaging';
import { notifyAdminsOfSupportMessage } from './studentSupportFlow';
import { isClientReplyLabel } from './client-menu';
import { saveStudentStaffDmState, STUDENT_STAFF_DM_STEP } from './student-staff-dm-thread';

export type StudentMentorContext = 'course' | 'lessons';

const MENTOR_COURSE_PICK_PREFIX = 'm:cr:';
const MENTOR_CONFIRM_PREFIX = 'm:mentor:';

function mentorCancelKeyboard() {
  return {
    inline_keyboard: [[{ text: '❌ Отменить', callback_data: `${MENTOR_CONFIRM_PREFIX}cancel` }]],
  };
}

function mentorPreviewKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✅ Отправить', callback_data: `${MENTOR_CONFIRM_PREFIX}send` }],
      [
        { text: '✏️ Изменить', callback_data: `${MENTOR_CONFIRM_PREFIX}edit` },
        { text: '❌ Отменить', callback_data: `${MENTOR_CONFIRM_PREFIX}cancel` },
      ],
    ],
  };
}

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
  homeworkLessonNumber?: number;
  homeworkSanityLessonId?: string;
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

  const enrollments = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
  if (enrollments.length === 1) return enrollments[0]!.courseId;
  if (enrollments.length === 0) return null;
  return null;
}

async function promptCoursePickerForMentor(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  options: MentorQuestionOptions,
): Promise<void> {
  const enrollments = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
  const context = options.context ?? 'lessons';
  const purpose =
    options.homework
      ? 'сдать домашку'
      : context === 'course'
        ? 'задать вопрос по курсу'
        : 'написать наставнику';

  try {
    await saveState(
      admin,
      telegramId,
      { chatId, messageId: 0 },
      'student:mentor-pick',
      {
        homework: options.homework ?? false,
        mentorContext: context,
        homeworkLessonNumber: options.homeworkLessonNumber,
        homeworkSanityLessonId: options.homeworkSanityLessonId,
      } as never,
    );
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

async function ensureCourseStaffSynced(
  admin: SupabaseClient,
  courseId: number,
  courseSlug?: string | null,
): Promise<void> {
  const slug = courseSlug?.trim();
  const content = slug
    ? await getDistrictCourseContent(slug).catch(() => null)
    : null;
  if (content) {
    await syncCourseStaffFromContent(admin, courseId, content, { courseSlug: slug ?? content.slug });
  }
}

async function finalizeMentorQuestionStart(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  options: MentorQuestionOptions & { courseId: number | null },
): Promise<void> {
  const context = options.context ?? 'lessons';
  const courseId = options.courseId;

  if (courseId != null) {
    await ensureCourseStaffSynced(admin, courseId, options.courseSlug);
  }

  const mentorCourseOpts = courseId != null ? { courseId } : undefined;
  let mentor: Awaited<ReturnType<typeof getStudentTeacher>> | null = null;
  let staffRole: StaffMessageRole | undefined;

  if (courseId != null) {
    if (options.homework) {
      const checker = await getStudentCheckStaff(admin, telegramId, courseId);
      mentor = checker;
      if (checker) staffRole = 'check';
    } else if (context === 'course') {
      const checker = await getStudentCheckStaff(admin, telegramId, courseId);
      mentor = checker;
      if (checker) staffRole = 'check';
    } else {
      const curator = await getStudentCurator(admin, telegramId, { courseId });
      mentor = curator;
      if (curator) staffRole = 'curator';
    }
  } else {
    const teacher = await getStudentTeacher(admin, telegramId, mentorCourseOpts);
    const curator = await getStudentCurator(admin, telegramId, mentorCourseOpts);
    mentor = teacher ?? curator;
    if (teacher) staffRole = 'teacher';
    else if (curator) staffRole = 'curator';
  }

  try {
    await saveState(
      admin,
      telegramId,
      { chatId, messageId: 0 },
      'student:mentor',
      {
        mentorTelegramId: mentor?.telegramId,
        homework: options.homework ?? false,
        staffRole,
        courseId: courseId ?? undefined,
        homeworkLessonNumber: options.homeworkLessonNumber,
        homeworkSanityLessonId: options.homeworkSanityLessonId,
      } as never,
    );
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  if (!mentor) {
    await sendAdminMessage(
      chatId,
      '💬 Наставник пока не назначен.\n\n' +
        'Напишите сообщение — мы передадим его администратору и свяжем с наставником.',
      mentorCancelKeyboard(),
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

  const hwQuestion =
    options.homeworkLessonNumber != null
      ? `📝 Вопрос по ДЗ №${options.homeworkLessonNumber}\n\n`
      : '';
  const intro = options.homework
    ? `📝 Сдать домашку${courseId != null ? ' (онлайн-курс)' : ''}\n\nНаставник: ${mentor.fullName ?? roleHint}\n\n`
    : hwQuestion +
      `💬 Вопрос ${context === 'course' ? 'по курсу' : 'наставнику'}\n\n${mentor.fullName ?? 'Наставник'}\n\n`;

  await sendAdminMessage(
    chatId,
    intro + 'Напишите сообщение одним текстом или приложите файл.',
    mentorCancelKeyboard(),
  );
}

async function showMentorMessagePreview(
  chatId: number,
  draftText: string,
  hasAttachment: boolean,
): Promise<void> {
  const lines = [
    '📋 Предпросмотр сообщения',
    '',
    draftText.trim() || '(без текста)',
    hasAttachment ? '\n📎 Вложение будет отправлено' : '',
    '',
    'Отправить наставнику?',
  ].filter(Boolean);
  await sendAdminMessage(chatId, lines.join('\n'), mentorPreviewKeyboard());
}

async function dispatchMentorDraft(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  state: { payload: Record<string, unknown> },
): Promise<void> {
  const mentorTelegramId = state.payload.mentorTelegramId as number | undefined;
  const staffRole = state.payload.staffRole as StaffMessageRole | undefined;
  const courseId = state.payload.courseId as number | undefined;
  const lessonNum = state.payload.homeworkLessonNumber as number | undefined;
  const isHwSubmit = Boolean(state.payload.homework) && lessonNum == null;
  const rawDraft = String(state.payload.draftText ?? '').trim() || 'Сообщение из Telegram';
  const draftText = rawDraft;
  const draftFileRef = state.payload.draftFileRef as string | undefined;
  const draftFileKind = state.payload.draftFileKind as 'photo' | 'document' | 'voice' | undefined;

  const attachment =
    draftFileRef && draftFileRef.startsWith('tg:')
      ? { ref: draftFileRef, kind: draftFileKind ?? ('document' as const) }
      : undefined;

  let contextIntro: string | undefined;
  if (lessonNum != null && staffRole === 'check') {
    contextIntro = `❓ Вопрос по ДЗ №${lessonNum}`;
  } else if (staffRole === 'curator' && courseId != null) {
    const { data: courseRow } = await admin
      .from('courses')
      .select('title')
      .eq('id', courseId)
      .maybeSingle();
    const title = (courseRow?.title as string | undefined)?.trim() ?? 'курсу';
    contextIntro = `💬 Сообщение от ученика по курсу «${title}»`;
  }

  const target = await forwardToMentor(
    admin,
    telegramId,
    mentorTelegramId,
    draftText,
    staffRole,
    attachment,
    courseId,
    { contextIntro, skipTopic: isHwSubmit && staffRole === 'check' },
  );
  if (target === 'support') {
    await notifyAdminsOfSupportMessage(admin, telegramId, draftText);
  }
  await clearStateIfAvailable(admin, telegramId);
  if (target === 'mentor' && mentorTelegramId && staffRole && staffRole !== 'teacher') {
    await saveStudentStaffDmState(admin, telegramId, chatId, {
      staffTelegramId: mentorTelegramId,
      staffRole: staffRole as 'admin' | 'curator' | 'check',
      courseId,
    });
  }
  const followUpHint =
    target === 'mentor' && staffRole && staffRole !== 'teacher'
      ? '\n\nМожете отправить ещё сообщение в этот диалог.'
      : '';
  await sendAdminMessage(
    chatId,
    target === 'mentor'
      ? `✅ Сообщение отправлено.${followUpHint}\n\nОтвет придёт в Telegram.`
      : '✅ Сообщение отправлено администратору.\n\nМы свяжем вас с наставником.',
    target === 'mentor' && staffRole && staffRole !== 'teacher'
      ? {
          inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cl:staff-dm:cancel' }]],
        }
      : undefined,
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
    const enrollments = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
    if (enrollments.length > 1) {
      await promptCoursePickerForMentor(admin, telegramId, chatId, options);
      return;
    }
  }

  const courseId = await resolveCourseIdForMentorQuestion(admin, telegramId, options);
  if (needsCourse && courseId == null) {
    const enrollments = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
    if (enrollments.length > 1) {
      await promptCoursePickerForMentor(admin, telegramId, chatId, options);
      return;
    }
    await sendAdminMessage(
      chatId,
      'Не удалось определить курс. Оформите доступ к курсу или выберите курс в меню.',
    );
    return;
  }
  let courseSlug = options.courseSlug ?? null;
  if (courseId != null && !courseSlug) {
    const enrollments = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
    courseSlug = enrollments.find((e) => e.courseId === courseId)?.slug ?? null;
  }
  await finalizeMentorQuestionStart(admin, telegramId, chatId, { ...options, courseId, courseSlug });
}

export async function handleStudentMentorCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  telegramId: number,
  callbackQueryId?: string,
  promptMessageId?: number,
): Promise<boolean> {
  if (data.startsWith(MENTOR_CONFIRM_PREFIX)) {
    if (callbackQueryId) {
      await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
    }
    let state = null;
    try {
      state = await getState(admin, telegramId);
    } catch (error) {
      if (!isConversationStateTableError(error)) throw error;
      return true;
    }
    if (data === `${MENTOR_CONFIRM_PREFIX}cancel`) {
      await clearStateIfAvailable(admin, telegramId);
      if (promptMessageId) {
        await telegramSend('deleteMessage', { chat_id: chatId, message_id: promptMessageId }).catch(
          () => undefined,
        );
      }
      return true;
    }
    if (!state || state.step !== 'student:mentor-confirm') {
      await sendAdminMessage(chatId, 'Сессия устарела. Откройте «Связь» снова.');
      return true;
    }
    if (data === `${MENTOR_CONFIRM_PREFIX}edit`) {
      await saveState(admin, telegramId, { chatId, messageId: 0 }, 'student:mentor', {
        ...state.payload,
        draftText: undefined,
        draftFileRef: undefined,
        draftFileKind: undefined,
      });
      await sendAdminMessage(
        chatId,
        'Напишите сообщение заново или приложите файл.',
        mentorCancelKeyboard(),
      );
      return true;
    }
    if (data === `${MENTOR_CONFIRM_PREFIX}send`) {
      await dispatchMentorDraft(admin, telegramId, chatId, state);
      return true;
    }
    return true;
  }

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

  const payload = state.payload as Record<string, unknown>;
  await clearStateIfAvailable(admin, telegramId);
  const enrollments = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
  const courseSlug = enrollments.find((e) => e.courseId === courseId)?.slug;
  await finalizeMentorQuestionStart(admin, telegramId, chatId, {
    homework: Boolean(payload.homework),
    context: (payload.mentorContext as StudentMentorContext | undefined) ?? 'course',
    courseId,
    courseSlug,
    homeworkLessonNumber: payload.homeworkLessonNumber as number | undefined,
    homeworkSanityLessonId: payload.homeworkSanityLessonId as string | undefined,
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
  attachment?: { ref: string; kind: 'photo' | 'document' | 'voice' },
  courseId?: number,
  topicDelivery?: { contextIntro?: string; skipTopic?: boolean },
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
    topicDelivery: {
      contextIntro: topicDelivery?.contextIntro,
      plain: true,
      skipTopic: topicDelivery?.skipTopic,
    },
  });
  return 'mentor';
}

export async function handleStudentMentorMessage(
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

  if (state?.step === 'student:mentor-confirm') {
    await sendAdminMessage(chatId, 'Используйте кнопки «Отправить», «Изменить» или «Отменить».');
    return true;
  }

  if (state?.step === STUDENT_STAFF_DM_STEP) return false;

  if (!state || state.step !== 'student:mentor') return false;

  const trimmed = text.trim();
  if (!trimmed) {
    await sendAdminMessage(chatId, 'Напишите текст или отправьте файл.');
    return true;
  }

  await saveState(admin, telegramId, { chatId, messageId: 0 }, 'student:mentor-confirm', {
    ...state.payload,
    draftText: trimmed,
  });
  await showMentorMessagePreview(chatId, trimmed, Boolean(state.payload.draftFileRef));
  return true;
}

export async function handleStudentMentorAttachment(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  caption: string,
  attachment: { fileId: string; kind: 'photo' | 'document' | 'voice' },
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
  if (state?.step === 'student:mentor-confirm') {
    await sendAdminMessage(chatId, 'Используйте кнопки под предпросмотром.');
    return true;
  }

  if (state?.step === STUDENT_STAFF_DM_STEP) return false;

  if (!state || state.step !== 'student:mentor') return false;

  const body = caption.trim()
    ? caption.trim()
    : attachment.kind === 'voice'
      ? 'Голосовое сообщение'
      : 'Вложение';
  await saveState(
    admin,
    telegramId,
    { chatId, messageId: 0 },
    'student:mentor-confirm',
    {
      ...state.payload,
      draftText: body,
      draftFileRef: `tg:${attachment.fileId}`,
      draftFileKind: attachment.kind,
    } as never,
  );
  await showMentorMessagePreview(chatId, body, true);
  return true;
}
