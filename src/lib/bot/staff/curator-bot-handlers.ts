import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminMessage, InlineKeyboard } from '@/lib/bot/admin/core';
import {
  clearStateIfAvailable,
  editAdminMessage,
  isConversationStateTableError,
  migrationText,
  saveState,
  sendAdminMessage,
} from '@/lib/bot/admin/core';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import { loadCuratorCourseStudents } from '@/lib/curator/students';
import {
  assertCuratorCourseAccess,
  findLessonInCabinet,
  loadCuratorBotCabinet,
} from './curator-bot-access';
import {
  renderCompletedDateConfirm,
  renderCuratorCourseHub,
  renderCuratorCoursePicker,
  renderCuratorLessonCard,
  renderCuratorLessonsInModule,
  renderCuratorLessonsModuleList,
  renderCuratorNoCourses,
  renderCuratorScheduleLessonPick,
  renderCuratorScheduleModuleList,
  renderCuratorScheduleScreen,
  renderCuratorStudentCard,
  renderCuratorStudentsList,
  renderScheduleDatePrompt,
  type CuratorBotSection,
} from './curator-bot-screens';
import { CURATOR_SCHEDULE_DATETIME_STEP, type CuratorSchedulePayload } from './curator-schedule-bot';
import { clearConflictingStaffStates } from './staff-reply-state';
import { staffHasCourseAccess } from '@/lib/bot/education/course-staff';
import { loadStaffCapabilities } from './capabilities';
import {
  loadStaffMyCourseRows,
  renderMyCourseListScreen,
} from './staff-my-course';
import {
  CURATOR_BOT_MENU_LABELS,
  resolveStaffBotMode,
  type StaffBotMode,
} from './staff-menu';

export type CuratorSchedulePayloadExt = CuratorSchedulePayload & {
  courseId?: number;
  lessonNumber?: number;
  allowCompleted?: boolean;
};

async function editScreen(message: AdminMessage, text: string, keyboard: InlineKeyboard) {
  await editAdminMessage(message, text, keyboard);
}

async function coursesForPicker(admin: SupabaseClient, telegramId: number) {
  const { listCuratorCourseOptions } = await import('@/lib/curator/course-context');
  return listCuratorCourseOptions(admin, telegramId);
}

export async function sendCuratorSectionForCourse(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
  section: CuratorBotSection,
  courseId: number,
): Promise<void> {
  await sendSectionScreen(admin, chatId, telegramId, section, courseId);
}

export async function sendCuratorSectionFromReply(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
  section: CuratorBotSection,
): Promise<void> {
  const { getStaffCourseWorkspace } = await import('./staff-course-session');
  const ws = await getStaffCourseWorkspace(admin, telegramId);
  if (ws?.role === 'curator') {
    await sendCuratorSectionForCourse(admin, chatId, telegramId, section, ws.courseId);
    return;
  }
  const courses = await coursesForPicker(admin, telegramId);
  if (courses.length === 0) {
    const screen = renderCuratorNoCourses();
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return;
  }
  if (courses.length > 1) {
    const screen = renderCuratorCoursePicker(section, courses);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return;
  }
  const courseId = courses[0]!.courseId;
  await sendSectionScreen(admin, chatId, telegramId, section, courseId);
}

async function sendSectionScreen(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
  section: CuratorBotSection,
  courseId: number,
) {
  const loaded = await loadCuratorBotCabinet(admin, telegramId, courseId);
  if (!loaded) {
    const screen = renderCuratorNoCourses();
    await sendAdminMessage(chatId, 'Нет доступа к этому курсу.', screen.keyboard);
    return;
  }
  const { data } = loaded;
  if (section === 'cal') {
    const screen = renderCuratorScheduleScreen(data.courseTitle, courseId, data);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
  } else if (section === 'les') {
    const screen = renderCuratorLessonsModuleList(courseId, data);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
  } else {
    const { students } = await loadCuratorCourseStudents(admin, telegramId, {
      courseId,
      courseSlug: loaded.ctx.slug,
    });
    const screen = renderCuratorStudentsList(courseId, data.courseTitle, students);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
  }
}

export async function handleCuratorBotCallback(
  admin: SupabaseClient,
  message: AdminMessage,
  telegramId: number,
  data: string,
): Promise<boolean> {
  if (!data.startsWith('c:')) return false;

  const parts = data.split(':');

  if (data === 'c:hub') {
    const caps = await loadStaffCapabilities(admin, telegramId);
    if (resolveStaffBotMode(caps) === 'combined') {
      const rows = await loadStaffMyCourseRows(admin, telegramId);
      const screen = renderMyCourseListScreen(rows);
      await editScreen(message, screen.text, screen.keyboard);
      return true;
    }
    const screen = renderCuratorCourseHub();
    await editScreen(message, screen.text, screen.keyboard);
    return true;
  }

  if (data === 'c:mc') {
    const rows = await loadStaffMyCourseRows(admin, telegramId);
    const screen = renderMyCourseListScreen(rows);
    await editScreen(message, screen.text, screen.keyboard);
    return true;
  }

  if (parts[1] === 'mc' && parts[2] && parts[3]) {
    const courseId = Number(parts[2]);
    const role = parts[3] as 'curator' | 'check';
    if (!Number.isFinite(courseId) || (role !== 'curator' && role !== 'check')) return true;
    const ok = await staffHasCourseAccess(admin, telegramId, courseId, role);
    if (!ok) {
      await editScreen(message, 'Нет доступа к этому курсу.', renderMyCourseListScreen([]).keyboard);
      return true;
    }
    const rows = await loadStaffMyCourseRows(admin, telegramId);
    const row = rows.find((r) => r.courseId === courseId && r.role === role);
    if (!row) {
      await editScreen(message, 'Назначение не найдено.', {
        inline_keyboard: [[{ text: '⬅️ Мои курсы', callback_data: 'c:mc' }]],
      });
      return true;
    }
    const { enterStaffCourseWorkspaceFromRow } = await import('./staff-course-hub-flow');
    await enterStaffCourseWorkspaceFromRow(admin, telegramId, message.chatId, row);
    return true;
  }

  if (parts[1] === 'pk' && parts[2]) {
    const section = parts[2] as CuratorBotSection;
    if (!['cal', 'les', 'stu'].includes(section)) return true;
    const courses = await coursesForPicker(admin, telegramId);
    if (courses.length === 0) {
      const screen = renderCuratorNoCourses();
      await editScreen(message, screen.text, screen.keyboard);
      return true;
    }
    if (courses.length === 1) {
      await showSectionEdit(admin, message, telegramId, section, courses[0]!.courseId);
      return true;
    }
    const screen = renderCuratorCoursePicker(section, courses);
    await editScreen(message, screen.text, screen.keyboard);
    return true;
  }

  if (parts[1] === 'cal' && parts[2]) {
    const courseId = Number(parts[2]);
    if (!Number.isFinite(courseId)) return true;
    const loaded = await loadCuratorBotCabinet(admin, telegramId, courseId);
    if (!loaded) {
      await editScreen(message, 'Нет доступа к курсу.', renderCuratorNoCourses().keyboard);
      return true;
    }
    if (parts[3] === 'any') {
      const screen = renderCuratorScheduleModuleList(courseId, loaded.data);
      await editScreen(message, screen.text, screen.keyboard);
      return true;
    }
    if (parts[3] === 'm' && parts[4] != null) {
      const modIdx = Number(parts[4]);
      const screen = renderCuratorScheduleLessonPick(courseId, modIdx, loaded.data);
      await editScreen(message, screen.text, screen.keyboard);
      return true;
    }
    const screen = renderCuratorScheduleScreen(loaded.data.courseTitle, courseId, loaded.data);
    await editScreen(message, screen.text, screen.keyboard);
    return true;
  }

  if (parts[1] === 'les' && parts[2]) {
    const courseId = Number(parts[2]);
    if (!Number.isFinite(courseId)) return true;
    const loaded = await loadCuratorBotCabinet(admin, telegramId, courseId);
    if (!loaded) {
      await editScreen(message, 'Нет доступа к курсу.', renderCuratorNoCourses().keyboard);
      return true;
    }
    if (parts[3] === 'm' && parts[4] != null) {
      const modIdx = Number(parts[4]);
      const screen = renderCuratorLessonsInModule(courseId, modIdx, loaded.data);
      await editScreen(message, screen.text, screen.keyboard);
      return true;
    }
    if (parts[3] === 'ln' && parts[4] != null) {
      const lessonNum = Number(parts[4]);
      const lesson = findLessonInCabinet(loaded.data, lessonNum);
      if (!lesson) {
        await editScreen(message, 'Занятие не найдено.', {
          inline_keyboard: [[{ text: '⬅️ Назад', callback_data: `c:les:${courseId}` }]],
        });
        return true;
      }
      const screen = renderCuratorLessonCard(courseId, lesson);
      await editScreen(message, screen.text, screen.keyboard);
      return true;
    }
    const screen = renderCuratorLessonsModuleList(courseId, loaded.data);
    await editScreen(message, screen.text, screen.keyboard);
    return true;
  }

  if (parts[1] === 'stu' && parts[2]) {
    const courseId = Number(parts[2]);
    if (!Number.isFinite(courseId)) return true;
    const ctx = await assertCuratorCourseAccess(admin, telegramId, courseId);
    if (!ctx) {
      await editScreen(message, 'Нет доступа к курсу.', renderCuratorNoCourses().keyboard);
      return true;
    }
    if (parts[3] === 's' && parts[4]) {
      const studentTg = Number(parts[4]);
      const loaded = await loadCuratorBotCabinet(admin, telegramId, courseId);
      if (!loaded) return true;
      const { students } = await loadCuratorCourseStudents(admin, telegramId, {
        courseId,
        courseSlug: ctx.slug,
      });
      const student = students.find((s) => s.telegramId === studentTg);
      if (!student) {
        await editScreen(message, 'Ученик не найден на этом курсе.', {
          inline_keyboard: [[{ text: '⬅️ Назад', callback_data: `c:stu:${courseId}` }]],
        });
        return true;
      }
      const screen = renderCuratorStudentCard(
        loaded.data.courseTitle,
        courseId,
        student,
        loaded.data.lessons,
      );
      await editScreen(message, screen.text, screen.keyboard);
      return true;
    }
    const loaded = await loadCuratorBotCabinet(admin, telegramId, courseId);
    if (!loaded) return true;
    const { students } = await loadCuratorCourseStudents(admin, telegramId, {
      courseId,
      courseSlug: ctx.slug,
    });
    const screen = renderCuratorStudentsList(courseId, loaded.data.courseTitle, students);
    await editScreen(message, screen.text, screen.keyboard);
    return true;
  }

  if (parts[1] === 'sd' && parts[2] && parts[3]) {
    const courseId = Number(parts[2]);
    const lessonNum = Number(parts[3]);
    const sub = parts[4];
    if (!Number.isFinite(courseId) || !Number.isFinite(lessonNum)) return true;
    const loaded = await loadCuratorBotCabinet(admin, telegramId, courseId);
    if (!loaded) {
      await editScreen(message, 'Нет доступа.', renderCuratorNoCourses().keyboard);
      return true;
    }
    const lesson = findLessonInCabinet(loaded.data, lessonNum);
    if (!lesson) {
      await editScreen(message, 'Занятие не найдено.', {
        inline_keyboard: [[{ text: '⬅️ Назад', callback_data: `c:cal:${courseId}` }]],
      });
      return true;
    }
    if (sub === 'cfm') {
      const screen = renderCompletedDateConfirm(courseId, lessonNum);
      await editScreen(message, screen.text, screen.keyboard);
      return true;
    }
    const allowCompleted = sub === 'go';
    if (lesson.sessionStatus === 'completed' && !allowCompleted) {
      const screen = renderCompletedDateConfirm(courseId, lessonNum);
      await editScreen(message, screen.text, screen.keyboard);
      return true;
    }
    try {
      await clearConflictingStaffStates(admin, telegramId, 'curator_schedule');
      await saveState(
        admin,
        telegramId,
        { chatId: message.chatId, messageId: message.messageId },
        CURATOR_SCHEDULE_DATETIME_STEP as never,
        {
          sanityLessonId: lesson.sanityId,
          lessonTitle: lesson.title,
          courseId,
          lessonNumber: lessonNum,
          allowCompleted: allowCompleted || lesson.sessionStatus !== 'completed',
        } satisfies CuratorSchedulePayloadExt as never,
      );
    } catch (error) {
      if (!isConversationStateTableError(error)) throw error;
      await sendAdminMessage(message.chatId, migrationText('bot_conversation_states.sql'));
      return true;
    }
    const screen = renderScheduleDatePrompt(courseId, lesson, {
      confirmCompleted: lesson.sessionStatus === 'completed',
    });
    await editScreen(message, screen.text, screen.keyboard);
    return true;
  }

  return false;
}

async function showSectionEdit(
  admin: SupabaseClient,
  message: AdminMessage,
  telegramId: number,
  section: CuratorBotSection,
  courseId: number,
) {
  const loaded = await loadCuratorBotCabinet(admin, telegramId, courseId);
  if (!loaded) {
    await editScreen(message, 'Нет доступа к курсу.', renderCuratorNoCourses().keyboard);
    return;
  }
  const { data } = loaded;
  if (section === 'cal') {
    const screen = renderCuratorScheduleScreen(data.courseTitle, courseId, data);
    await editScreen(message, screen.text, screen.keyboard);
  } else if (section === 'les') {
    const screen = renderCuratorLessonsModuleList(courseId, data);
    await editScreen(message, screen.text, screen.keyboard);
  } else {
    const { students } = await loadCuratorCourseStudents(admin, telegramId, {
      courseId,
      courseSlug: loaded.ctx.slug,
    });
    const screen = renderCuratorStudentsList(courseId, data.courseTitle, students);
    await editScreen(message, screen.text, screen.keyboard);
  }
}

export async function handleCuratorBotReplyMenu(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
  mode: StaffBotMode,
): Promise<boolean> {
  if (mode !== 'curator_only' && mode !== 'combined') return false;

  if (text === CURATOR_BOT_MENU_LABELS.schedule) {
    await sendCuratorSectionFromReply(admin, chatId, telegramId, 'cal');
    return true;
  }
  if (text === CURATOR_BOT_MENU_LABELS.lessons) {
    await sendCuratorSectionFromReply(admin, chatId, telegramId, 'les');
    return true;
  }
  if (text === CURATOR_BOT_MENU_LABELS.students) {
    await sendCuratorSectionFromReply(admin, chatId, telegramId, 'stu');
    return true;
  }
  if (text === CURATOR_BOT_MENU_LABELS.cabinet) {
    try {
      const url = await createCabinetLoginUrl(admin, telegramId, '/cabinet/staff');
      await sendAdminMessage(chatId, '🌐 Кабинет на сайте:', {
        inline_keyboard: [[{ text: '🌐 Открыть кабинет', url }]],
      });
    } catch {
      await sendAdminMessage(chatId, 'Не удалось открыть ссылку на кабинет.');
    }
    return true;
  }
  return false;
}

export async function verifySchedulePayloadCourse(
  admin: SupabaseClient,
  telegramId: number,
  payload: CuratorSchedulePayloadExt,
): Promise<boolean> {
  if (payload.courseId == null) return false;
  const ctx = await assertCuratorCourseAccess(admin, telegramId, payload.courseId);
  if (!ctx) return false;
  const loaded = await loadCuratorBotCabinet(admin, telegramId, payload.courseId);
  if (!loaded || payload.lessonNumber == null) return false;
  const lesson = findLessonInCabinet(loaded.data, payload.lessonNumber);
  if (!lesson || lesson.sanityId !== payload.sanityLessonId) return false;
  if (lesson.sessionStatus === 'completed' && !payload.allowCompleted) return false;
  return true;
}
