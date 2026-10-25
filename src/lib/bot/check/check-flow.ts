import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  clearStateIfAvailable,
  getState,
  isConversationStateTableError,
  sendAdminMessage,
  type AdminMessage,
} from '@/lib/bot/admin/core';
import { loadStaffCapabilities } from '@/lib/bot/staff/capabilities';
import { CHECK_BOT_MENU_LABELS, isStaffMenuLabel, resolveStaffBotMode } from '@/lib/bot/staff/staff-menu';
import {
  getStaffCourseWorkspace,
  resetStaffDialogKeepWorkspace,
  restoreStaffCourseWorkspace,
  STAFF_WORKSPACE_PAYLOAD_KEY,
  type StaffCourseWorkspace,
} from '@/lib/bot/staff/staff-course-session';
import {
  CHECK_HW_COMMENT_STEP,
  CHECK_REJECT_COMMENT_STEP,
  CHECK_REJECT_FILE_STEP,
  CHECK_REJECT_PHOTO_STEP,
  CHECK_REJECT_TEXT_STEP,
  CHECK_REJECT_VOICE_STEP,
  CHECK_STU_SEARCH_STEP,
  STAFF_CHECK_REPLY_STEP,
} from '@/lib/bot/staff/staff-steps';
import {
  addCourseHomeworkReviewComment,
  CourseHomeworkError,
} from '@/lib/bot/education/course-homework';
import { getCuratorStudentRecord } from '@/lib/bot/curator/curatorData';
import { formatTelegramFileRef } from '@/lib/bot/studentHomeworkFlow';
import { deliverStaffToStudent } from '@/lib/bot/staff/messaging';
import { listCheckCourses } from './check-access';
import {
  filterStudentsByName,
  loadCheckHomeworkStudents,
  loadCheckStudentViews,
  setCheckStudentSearchQuery,
} from './check-data';
import { originFromPayload, sendHomeworkHub, showRejectDraftConfirm } from './check-hw-callbacks';
import { handleCheckBotCallback } from './check-handlers';
import { CHECK_LIST_PAGE_SIZE, paginateItems } from './check-homework-meta';
import { renderCheckStudentsList } from './check-screens';
import {
  renderCheckCoursePicker,
  renderCheckNoCourses,
  type CheckBotSection,
} from './check-screens';

export async function canUseCheckBot(admin: SupabaseClient, telegramId: number): Promise<boolean> {
  const caps = await loadStaffCapabilities(admin, telegramId);
  if (caps.canCourseStaffBot) return true;
  const ws = await getStaffCourseWorkspace(admin, telegramId);
  return ws?.role === 'check';
}

async function restoreWorkspaceAfterCheckDialog(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  payload: Record<string, unknown> | undefined,
): Promise<void> {
  const ws = (payload?.staffWorkspace ?? payload?.[STAFF_WORKSPACE_PAYLOAD_KEY]) as
    | StaffCourseWorkspace
    | undefined;
  if (ws?.courseId) {
    await restoreStaffCourseWorkspace(admin, telegramId, chatId, ws);
  }
}

const MENU_TO_SECTION: Record<string, CheckBotSection> = {
  [CHECK_BOT_MENU_LABELS.home]: 'home',
  [CHECK_BOT_MENU_LABELS.homework]: 'hw',
  [CHECK_BOT_MENU_LABELS.students]: 'stu',
  [CHECK_BOT_MENU_LABELS.messages]: 'msg',
  [CHECK_BOT_MENU_LABELS.library]: 'lib',
};

export async function sendCheckSectionForCourse(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
  section: CheckBotSection,
  courseId: number,
): Promise<void> {
  const { assertCheckCourseAccess } = await import('./check-access');
  const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
  await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
  if (section === 'home') {
    const { loadCheckHomeStats } = await import('./check-data');
    const { renderCheckHome } = await import('./check-screens');
    const stats = await loadCheckHomeStats(admin, telegramId, courseId);
    const screen = renderCheckHome(courseId, ctx.title, stats);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return;
  }
  if (section === 'hw') {
    const { renderCheckHomeworkHub } = await import('./check-screens');
    const screen = renderCheckHomeworkHub(courseId, ctx.title);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return;
  }
  if (section === 'stu') {
    const { renderCheckStudentsHub } = await import('./check-screens');
    const { clearCheckStudentSearchQuery } = await import('./check-data');
    clearCheckStudentSearchQuery(courseId, telegramId);
    const screen = renderCheckStudentsHub(courseId, ctx.title);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return;
  }
  if (section === 'msg') {
    const { listCourseStudentTelegramIds } = await import('@/lib/curator/students');
    const { listCheckThreadsForCourse } = await import('@/lib/bot/staff/messaging');
    const { renderCheckMessagesHub } = await import('./check-screens');
    const studentIds = await listCourseStudentTelegramIds(admin, courseId);
    const { threads } = await listCheckThreadsForCourse(admin, telegramId, courseId, studentIds);
    const incoming = threads.filter(
      (t) => t.unreadCount > 0 || t.lastDirection === 'student_to_staff',
    ).length;
    const screen = renderCheckMessagesHub(courseId, ctx.title, incoming);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return;
  }
  const { loadCheckCourseLibrary } = await import('./check-library');
  const { renderCheckLibraryModules } = await import('./check-screens');
  const lib = await loadCheckCourseLibrary(ctx.slug);
  const screen = renderCheckLibraryModules(courseId, ctx.title, lib?.modules ?? []);
  await sendAdminMessage(chatId, screen.text, screen.keyboard);
}

async function sendCheckSection(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
  section: CheckBotSection,
): Promise<void> {
  const ws = await getStaffCourseWorkspace(admin, telegramId);
  if (ws?.role === 'check') {
    await sendCheckSectionForCourse(admin, chatId, telegramId, section, ws.courseId);
    return;
  }
  const courses = await listCheckCourses(admin, telegramId);
  if (courses.length === 0) {
    const screen = renderCheckNoCourses();
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return;
  }
  if (courses.length > 1) {
    const screen = renderCheckCoursePicker(section, courses);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return;
  }
  await sendCheckSectionForCourse(admin, chatId, telegramId, section, courses[0]!.courseId);
}

export async function sendCheckStart(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
  testFooter = '',
): Promise<void> {
  await clearStateIfAvailable(admin, telegramId);
  const caps = await loadStaffCapabilities(admin, telegramId);
  const { staffGlobalReplyKeyboard } = await import('@/lib/bot/staff/staff-menu');
  const { STAFF_COURSE_HOME_TEXT } = await import('@/lib/bot/staff/staff-course-hub-flow');
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: STAFF_COURSE_HOME_TEXT + testFooter,
    reply_markup: staffGlobalReplyKeyboard(caps),
  });
}

export async function handleCheckMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  if (!(await canUseCheckBot(admin, telegramId))) return false;

  const caps = await loadStaffCapabilities(admin, telegramId);
  const mode = resolveStaffBotMode(caps);
  if (mode === 'teacher_only') return false;

  const wsEarly = await getStaffCourseWorkspace(admin, telegramId);
  const teacherStyleHwMsg = new Set<string>([
    CHECK_BOT_MENU_LABELS.homework,
    CHECK_BOT_MENU_LABELS.messages,
  ]);
  if (teacherStyleHwMsg.has(text) && wsEarly?.role !== 'check') {
    return false;
  }
  const { STAFF_COURSE_MANAGEMENT_LABEL } = await import('@/lib/bot/staff/staff-menu');
  if (text === STAFF_COURSE_MANAGEMENT_LABEL || text === '🎓 Курс') {
    const { exitStaffCourseWorkspace } = await import('@/lib/bot/staff/staff-course-session');
    await exitStaffCourseWorkspace(admin, telegramId, chatId);
    return true;
  }

  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
  const step = state?.step as string | undefined;

  if (state && step === STAFF_CHECK_REPLY_STEP) {
    const payload = state.payload as {
      studentTelegramId?: number;
      courseId?: number;
      returnTo?: string;
    };
    if (isStaffMenuLabel(text, caps)) {
      await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
    } else {
    if (/^отмена$/i.test(text.trim())) {
      await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
      await sendAdminMessage(chatId, 'Отправка отменена.');
      return true;
    }
    try {
      await deliverStaffToStudent(admin, {
        staffTelegramId: telegramId,
        staffRole: 'check',
        studentTelegramId: payload.studentTelegramId!,
        body: text.trim(),
        courseId: payload.courseId,
      });
      const prevPayload = state.payload as Record<string, unknown> | undefined;
      await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
      if (payload.returnTo === 'hw' && payload.courseId) {
        await sendHomeworkHub(admin, chatId, telegramId, payload.courseId, '✅ Сообщение отправлено ученику.');
      } else {
        await restoreWorkspaceAfterCheckDialog(admin, telegramId, chatId, prevPayload);
        await sendAdminMessage(chatId, '✅ Сообщение отправлено ученику.');
      }
    } catch (error) {
      await sendAdminMessage(chatId, error instanceof Error ? error.message : 'Не удалось отправить.');
    }
    return true;
    }
  }

  if (
    state &&
    (step === CHECK_REJECT_COMMENT_STEP ||
      step === CHECK_REJECT_FILE_STEP ||
      step === CHECK_REJECT_TEXT_STEP ||
      step === CHECK_REJECT_VOICE_STEP ||
      step === CHECK_REJECT_PHOTO_STEP)
  ) {
    const payload = state.payload as {
      courseId?: number;
      studentId?: string;
      hwNumber?: number;
    };
    if (isStaffMenuLabel(text, caps)) {
      await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
    } else {
    if (/^отмена$/i.test(text.trim())) {
      await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
      await sendAdminMessage(chatId, 'Отменено.');
      return true;
    }
    const courseId = payload.courseId;
    const studentId = payload.studentId;
    const hwNumber = payload.hwNumber;
    if (!courseId || !studentId || hwNumber == null) return false;
    const prev = state.payload as {
      draftFileRef?: string;
      draftFileKind?: 'photo' | 'voice' | 'document';
    };
    await showRejectDraftConfirm(
      admin,
      telegramId,
      chatId,
      {
        courseId,
        studentId,
        hwNumber,
        draftText: text.trim(),
        draftFileRef: prev.draftFileRef,
        draftFileKind: prev.draftFileKind ?? null,
      },
      originFromPayload(state.payload as Record<string, unknown>),
    );
    return true;
    }
  }

  if (state && step === CHECK_HW_COMMENT_STEP) {
    const payload = state.payload as { courseId?: number; studentId?: string; hwNumber?: number };
    if (isStaffMenuLabel(text, caps)) {
      await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
    } else {
    if (/^отмена$/i.test(text.trim())) {
      await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
      await sendAdminMessage(chatId, 'Отменено.');
      return true;
    }
    const courseId = payload.courseId;
    const studentId = payload.studentId;
    const hwNumber = payload.hwNumber;
    if (!courseId || !studentId || hwNumber == null) return false;
    const { assertCheckCourseAccess } = await import('./check-access');
    const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
    const { students } = await loadCheckHomeworkStudents(admin, telegramId, courseId);
    const student = getCuratorStudentRecord(students, studentId);
    if (!student) return true;
    try {
      const { lesson } = await addCourseHomeworkReviewComment(
        admin,
        telegramId,
        student.telegramId,
        hwNumber,
        text.trim(),
        { courseId, courseSlug: ctx.slug },
      );
      const { data: member } = await admin
        .from('bot_members')
        .select('chat_id')
        .eq('telegram_id', student.telegramId)
        .maybeSingle();
      const studentChatId = member?.chat_id as number | undefined;
      if (studentChatId) {
        await telegramSend('sendMessage', {
          chat_id: studentChatId,
          text:
            `💬 Комментарий проверяющего к ДЗ №${lesson.lessonNumber} «${lesson.title}»:\n\n` +
            text.trim(),
        });
      }
      await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
      await sendHomeworkHub(
        admin,
        chatId,
        telegramId,
        courseId,
        '✅ Комментарий сохранён (статус не изменён).',
      );
    } catch (error) {
      const msg = error instanceof CourseHomeworkError ? error.message : 'Не удалось сохранить комментарий.';
      await sendAdminMessage(chatId, msg);
    }
    return true;
    }
  }

  if (state && step === CHECK_STU_SEARCH_STEP) {
    const courseId = state.payload.courseId as number | undefined;
    if (!courseId) return false;
    if (isStaffMenuLabel(text, caps)) {
      await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
    } else {
      if (/^отмена$/i.test(text.trim())) {
        await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
        const { renderCheckStudentsHub } = await import('./check-screens');
        const { assertCheckCourseAccess } = await import('./check-access');
        const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
        const screen = renderCheckStudentsHub(courseId, ctx.title);
        await sendAdminMessage(chatId, screen.text, screen.keyboard);
        return true;
      }
      setCheckStudentSearchQuery(courseId, telegramId, text.trim());
      await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
      const { assertCheckCourseAccess } = await import('./check-access');
      const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
      const { students: all } = await loadCheckStudentViews(admin, telegramId, courseId);
      const filtered = filterStudentsByName(all, text.trim());
      const { pageItems, totalPages } = paginateItems(filtered, 0, CHECK_LIST_PAGE_SIZE);
      const screen = renderCheckStudentsList(courseId, ctx.title, pageItems, {
        page: 0,
        totalPages,
        searchQuery: text.trim(),
      });
      await sendAdminMessage(chatId, screen.text, screen.keyboard);
      return true;
    }
  }

  const section = MENU_TO_SECTION[text];
  if (section) {
    const ws = await getStaffCourseWorkspace(admin, telegramId);
    if (mode === 'combined' && ws?.role !== 'check') {
      return false;
    }
    if (ws?.role === 'check') {
      await sendCheckSectionForCourse(admin, chatId, telegramId, section, ws.courseId);
    } else {
      await sendCheckSection(admin, chatId, telegramId, section);
    }
    return true;
  }

  const ws = await getStaffCourseWorkspace(admin, telegramId);
  if (ws?.role !== 'check') return false;
  await sendAdminMessage(chatId, 'Разделы — на кнопках меню под полем ввода.');
  return true;
}

export async function handleCheckCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!data.startsWith('k:')) return false;
  if (!(await canUseCheckBot(admin, telegramId))) return false;

  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId }).catch(() => undefined);
  }

  if (data.startsWith('k:pk:')) {
    const ws = await getStaffCourseWorkspace(admin, telegramId);
    if (ws?.role === 'check' && ws.courseId) {
      await handleCheckBotCallback(admin, { chatId, messageId }, telegramId, `k:home:${ws.courseId}`);
    } else {
      const section = data.slice(5) as CheckBotSection;
      if (!['home', 'hw', 'stu', 'msg', 'lib'].includes(section)) return true;
      const courses = await listCheckCourses(admin, telegramId);
      if (courses.length === 0) {
        const screen = renderCheckNoCourses();
        await sendAdminMessage(chatId, screen.text, screen.keyboard);
      } else if (courses.length === 1) {
        await handleCheckBotCallback(
          admin,
          { chatId, messageId },
          telegramId,
          `k:home:${courses[0]!.courseId}`,
        );
      } else {
        const screen = renderCheckCoursePicker(section, courses);
        await sendAdminMessage(chatId, screen.text, screen.keyboard);
      }
    }
    return true;
  }

  const message: AdminMessage = { chatId, messageId };
  await handleCheckBotCallback(admin, message, telegramId, data);
  return true;
}

export async function handleCheckAttachment(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  kind: 'voice' | 'photo' | 'document',
  fileId: string,
): Promise<boolean> {
  if (!(await canUseCheckBot(admin, telegramId))) return false;

  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }
  const step = state?.step as string | undefined;

  if (state && step === STAFF_CHECK_REPLY_STEP) {
    const payload = state.payload as {
      studentTelegramId?: number;
      courseId?: number;
      returnTo?: string;
    };
    if (!payload.studentTelegramId) return false;
    try {
      await deliverStaffToStudent(admin, {
        staffTelegramId: telegramId,
        staffRole: 'check',
        studentTelegramId: payload.studentTelegramId,
        body: '',
        attachmentRef: formatTelegramFileRef(fileId),
        attachmentKind: kind,
        courseId: payload.courseId,
      });
      await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
      if (payload.returnTo === 'hw' && payload.courseId) {
        await sendHomeworkHub(admin, chatId, telegramId, payload.courseId, '✅ Вложение отправлено ученику.');
      } else {
        await sendAdminMessage(chatId, '✅ Вложение отправлено ученику.');
      }
    } catch (error) {
      await sendAdminMessage(chatId, error instanceof Error ? error.message : 'Не удалось отправить.');
    }
    return true;
  }

  const rejectFileStep = step === CHECK_REJECT_FILE_STEP;
  const rejectCommentStep =
    step === CHECK_REJECT_COMMENT_STEP ||
    step === CHECK_REJECT_VOICE_STEP ||
    step === CHECK_REJECT_PHOTO_STEP ||
    step === CHECK_REJECT_TEXT_STEP;
  if (!state || (!rejectFileStep && !rejectCommentStep)) return false;

  const payload = state.payload as {
    courseId?: number;
    studentId?: string;
    hwNumber?: number;
    draftFileRef?: string;
    draftFileKind?: 'photo' | 'voice' | 'document';
    draftVoiceRef?: string;
    draftText?: string;
  };
  const courseId = payload.courseId;
  const studentId = payload.studentId;
  const hwNumber = payload.hwNumber;
  if (!courseId || !studentId || hwNumber == null) return false;

  if (rejectFileStep && (kind === 'photo' || kind === 'document')) {
    const { promptRejectNoteStep } = await import('./check-hw-callbacks');
    await promptRejectNoteStep(admin, telegramId, chatId, {
      courseId,
      studentId,
      hwNumber,
      draftFileRef: formatTelegramFileRef(fileId),
      draftFileKind: kind,
    });
    return true;
  }

  if (kind === 'voice' && payload.draftFileRef && payload.draftFileKind !== 'voice') {
    await showRejectDraftConfirm(
      admin,
      telegramId,
      chatId,
      {
        courseId,
        studentId,
        hwNumber,
        draftText: payload.draftText,
        draftFileRef: payload.draftFileRef,
        draftFileKind: payload.draftFileKind ?? null,
        draftVoiceRef: formatTelegramFileRef(fileId),
      },
      originFromPayload(state.payload as Record<string, unknown>),
    );
    return true;
  }

  await showRejectDraftConfirm(
    admin,
    telegramId,
    chatId,
    {
      courseId,
      studentId,
      hwNumber,
      draftText:
        kind === 'voice'
          ? payload.draftText
          : payload.draftText ??
            (kind === 'photo' ? 'Комментарий на фото' : 'Комментарий в файле'),
      draftFileKind: kind === 'voice' ? 'voice' : payload.draftFileKind ?? kind,
      draftFileRef: formatTelegramFileRef(fileId),
      draftVoiceRef: payload.draftVoiceRef,
    },
    originFromPayload(state.payload as Record<string, unknown>),
  );
  return true;
}
