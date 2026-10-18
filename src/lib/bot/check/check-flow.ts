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
import {
  CHECK_BOT_MENU_LABELS,
  CHECK_BOT_MENU_LABEL_SET,
  resolveStaffBotMode,
} from '@/lib/bot/staff/staff-menu';
import { isStaffMenuLabel } from '@/lib/bot/staff/staff-menu';
import {
  getStaffCourseWorkspace,
  restoreStaffCourseWorkspace,
  STAFF_WORKSPACE_PAYLOAD_KEY,
  type StaffCourseWorkspace,
} from '@/lib/bot/staff/staff-course-session';
import {
  CHECK_HW_COMMENT_STEP,
  CHECK_REJECT_PHOTO_STEP,
  CHECK_REJECT_TEXT_STEP,
  CHECK_REJECT_VOICE_STEP,
  CHECK_STU_SEARCH_STEP,
  STAFF_CHECK_REPLY_STEP,
} from '@/lib/bot/staff/staff-steps';
import {
  rejectCourseHomeworkByCurator,
  addCourseHomeworkReviewComment,
  CourseHomeworkError,
} from '@/lib/bot/education/course-homework';
import { getCuratorStudentRecord } from '@/lib/bot/curator/curatorData';
import { formatTelegramFileRef, notifyStudentHomeworkReviewed } from '@/lib/bot/studentHomeworkFlow';
import { deliverStaffToStudent } from '@/lib/bot/staff/messaging';
import { listCheckCourses } from './check-access';
import {
  filterStudentsByName,
  loadCheckHomeworkStudents,
  loadCheckStudentViews,
  setCheckStudentSearchQuery,
} from './check-data';
import { handleCheckBotCallback } from './check-handlers';
import { CHECK_LIST_PAGE_SIZE, paginateItems } from './check-homework-meta';
import { renderCheckStudentsList } from './check-screens';
import {
  CHECK_BOT_WELCOME_TEXT,
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
  if (section === 'hw') {
    const { renderCheckHomeworkHub } = await import('./check-screens');
    const screen = renderCheckHomeworkHub(courseId, ctx.title);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return;
  }
  if (section === 'stu') {
    const { students } = await loadCheckStudentViews(admin, telegramId, courseId);
    const screen = renderCheckStudentsList(courseId, ctx.title, students);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return;
  }
  if (section === 'msg') {
    const { listCourseStudentTelegramIds } = await import('@/lib/curator/students');
    const { listCheckThreadsForCourse } = await import('@/lib/bot/staff/messaging');
    const { renderCheckMessagesInbox } = await import('./check-screens');
    const studentIds = await listCourseStudentTelegramIds(admin, courseId);
    const { threads, storageEnabled } = await listCheckThreadsForCourse(
      admin,
      telegramId,
      courseId,
      studentIds,
    );
    const screen = renderCheckMessagesInbox(courseId, ctx.title, threads, storageEnabled);
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
  const caps = await loadStaffCapabilities(admin, telegramId);
  const { staffGlobalReplyKeyboard } = await import('@/lib/bot/staff/staff-menu');
  const { STAFF_COURSE_HOME_TEXT, tryAutoEnterSingleCourseWorkspace } = await import(
    '@/lib/bot/staff/staff-course-hub-flow'
  );
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: STAFF_COURSE_HOME_TEXT + testFooter,
    reply_markup: staffGlobalReplyKeyboard(caps),
  });
  await tryAutoEnterSingleCourseWorkspace(admin, chatId, telegramId);
}

export async function handleCheckMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  if (!(await canUseCheckBot(admin, telegramId))) return false;

  const caps = await loadStaffCapabilities(admin, telegramId);

  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
  const step = state?.step as string | undefined;

  if (state && step === STAFF_CHECK_REPLY_STEP) {
    const payload = state.payload as { studentTelegramId?: number; courseId?: number };
    if (isStaffMenuLabel(text, caps)) {
      await clearStateIfAvailable(admin, telegramId);
      return false;
    }
    if (/^отмена$/i.test(text.trim())) {
      await clearStateIfAvailable(admin, telegramId);
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
      await clearStateIfAvailable(admin, telegramId);
      await restoreWorkspaceAfterCheckDialog(admin, telegramId, chatId, prevPayload);
      await sendAdminMessage(chatId, '✅ Сообщение отправлено ученику.');
    } catch (error) {
      await sendAdminMessage(chatId, error instanceof Error ? error.message : 'Не удалось отправить.');
    }
    return true;
  }

  if (state && step === CHECK_REJECT_TEXT_STEP) {
    const payload = state.payload as { courseId?: number; studentId?: string; hwNumber?: number };
    if (isStaffMenuLabel(text, caps)) {
      await clearStateIfAvailable(admin, telegramId);
      return false;
    }
    if (/^отмена$/i.test(text.trim())) {
      await clearStateIfAvailable(admin, telegramId);
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
      const { lesson } = await rejectCourseHomeworkByCurator(
        admin,
        telegramId,
        student.telegramId,
        hwNumber,
        text.trim(),
        { courseId, courseSlug: ctx.slug },
      );
      await notifyStudentHomeworkReviewed(admin, student.telegramId, {
        lessonNumber: lesson.lessonNumber,
        title: lesson.title,
        approved: false,
        note: text.trim(),
      });
      const prevPayload = state.payload as Record<string, unknown> | undefined;
      await clearStateIfAvailable(admin, telegramId);
      await restoreWorkspaceAfterCheckDialog(admin, telegramId, chatId, prevPayload);
      await sendAdminMessage(chatId, '🔄 ДЗ отправлено на доработку с комментарием.');
    } catch (error) {
      const msg = error instanceof CourseHomeworkError ? error.message : 'Не удалось вернуть на доработку.';
      await sendAdminMessage(chatId, msg);
    }
    return true;
  }

  if (state && step === CHECK_HW_COMMENT_STEP) {
    const payload = state.payload as { courseId?: number; studentId?: string; hwNumber?: number };
    if (isStaffMenuLabel(text, caps)) {
      await clearStateIfAvailable(admin, telegramId);
      return false;
    }
    if (/^отмена$/i.test(text.trim())) {
      await clearStateIfAvailable(admin, telegramId);
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
      const prevPayload = state.payload as Record<string, unknown> | undefined;
      await clearStateIfAvailable(admin, telegramId);
      await restoreWorkspaceAfterCheckDialog(admin, telegramId, chatId, prevPayload);
      await sendAdminMessage(chatId, '✅ Комментарий сохранён (статус не изменён).');
    } catch (error) {
      const msg = error instanceof CourseHomeworkError ? error.message : 'Не удалось сохранить комментарий.';
      await sendAdminMessage(chatId, msg);
    }
    return true;
  }

  if (state && step === CHECK_STU_SEARCH_STEP) {
    const courseId = state.payload.courseId as number | undefined;
    if (!courseId) return false;
    if (isStaffMenuLabel(text, caps)) {
      await clearStateIfAvailable(admin, telegramId);
      return false;
    }
    if (/^отмена$/i.test(text.trim())) {
      await clearStateIfAvailable(admin, telegramId);
      await sendAdminMessage(chatId, 'Поиск отменён.');
      return true;
    }
    setCheckStudentSearchQuery(courseId, telegramId, text.trim());
    await clearStateIfAvailable(admin, telegramId);
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

  const ws = await getStaffCourseWorkspace(admin, telegramId);
  if (ws?.role !== 'check') return false;

  if (!CHECK_BOT_MENU_LABEL_SET.has(text)) return false;

  const section = MENU_TO_SECTION[text];
  if (!section) return false;
  await sendCheckSectionForCourse(admin, chatId, telegramId, section, ws.courseId);
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

  if (data.startsWith('k:pk:')) {
    const section = data.slice(5) as CheckBotSection;
    if (!['hw', 'stu', 'msg', 'lib'].includes(section)) return true;
    const courses = await listCheckCourses(admin, telegramId);
    if (courses.length === 0) {
      const screen = renderCheckNoCourses();
      await sendAdminMessage(chatId, screen.text, screen.keyboard);
    } else if (courses.length === 1) {
      await handleCheckBotCallback(admin, { chatId, messageId }, telegramId, `k:sec:${section}:${courses[0]!.courseId}`);
    } else {
      const screen = renderCheckCoursePicker(section, courses);
      await sendAdminMessage(chatId, screen.text, screen.keyboard);
    }
    if (callbackQueryId) {
      await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
    }
    return true;
  }

  const message: AdminMessage = { chatId, messageId };
  await handleCheckBotCallback(admin, message, telegramId, data);
  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }
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

  if (state && step === STAFF_CHECK_REPLY_STEP && (kind === 'photo' || kind === 'document')) {
    const payload = state.payload as { studentTelegramId?: number; courseId?: number };
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
      await clearStateIfAvailable(admin, telegramId);
      await sendAdminMessage(chatId, '✅ Вложение отправлено ученику.');
    } catch (error) {
      await sendAdminMessage(chatId, error instanceof Error ? error.message : 'Не удалось отправить.');
    }
    return true;
  }

  const expected =
    kind === 'voice'
      ? CHECK_REJECT_VOICE_STEP
      : kind === 'photo' || kind === 'document'
        ? CHECK_REJECT_PHOTO_STEP
        : null;
  if (!expected || !state || step !== expected) return false;

  const payload = state.payload as { courseId?: number; studentId?: string; hwNumber?: number };
  const courseId = payload.courseId;
  const studentId = payload.studentId;
  const hwNumber = payload.hwNumber;
  if (!courseId || !studentId || hwNumber == null) return false;

  await clearStateIfAvailable(admin, telegramId);
  const { assertCheckCourseAccess } = await import('./check-access');
  const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
  const { students } = await loadCheckHomeworkStudents(admin, telegramId, courseId);
  const student = getCuratorStudentRecord(students, studentId);
  if (!student) {
    await sendAdminMessage(chatId, 'Работа не найдена.');
    return true;
  }
  try {
    const { lesson } = await rejectCourseHomeworkByCurator(
      admin,
      telegramId,
      student.telegramId,
      hwNumber,
      kind === 'voice'
        ? 'Голосовой комментарий — см. сообщение ниже.'
        : 'Комментарий во вложении.',
      { courseId, courseSlug: ctx.slug },
    );
    await notifyStudentHomeworkReviewed(admin, student.telegramId, {
      lessonNumber: lesson.lessonNumber,
      title: lesson.title,
      approved: false,
      note:
        kind === 'voice'
          ? 'Голосовой комментарий проверяющего.'
          : 'Комментарий проверяющего во вложении.',
      reviewFileRef: formatTelegramFileRef(fileId),
      reviewFileKind: kind === 'voice' ? 'voice' : kind === 'photo' ? 'photo' : 'document',
    });
    await sendAdminMessage(chatId, `🔄 ДЗ №${hwNumber} на доработке. Комментарий отправлен ученику.`, {
      inline_keyboard: [
        [{ text: '⬅️ К работе', callback_data: `k:hw:${courseId}:i:${studentId}:${hwNumber}` }],
      ],
    });
  } catch (error) {
    const msg = error instanceof CourseHomeworkError ? error.message : 'Не удалось вернуть на доработку.';
    await sendAdminMessage(chatId, msg);
  }
  return true;
}
