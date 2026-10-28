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
import { formatLessonDateTimeRu } from '@/lib/teacher/format';

const curatorStudentSearchCache = new Map<string, string>();

function curatorSearchKey(courseId: number, staffId: number): string {
  return `cur:${staffId}:${courseId}`;
}

export function setCuratorStudentSearchQuery(courseId: number, staffId: number, query: string): void {
  curatorStudentSearchCache.set(curatorSearchKey(courseId, staffId), query);
}

export function getCuratorStudentSearchQuery(courseId: number, staffId: number): string | undefined {
  return curatorStudentSearchCache.get(curatorSearchKey(courseId, staffId));
}

export function clearCuratorStudentSearchQuery(courseId: number, staffId: number): void {
  curatorStudentSearchCache.delete(curatorSearchKey(courseId, staffId));
}

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
    const token = parts[3];
    if (!Number.isFinite(courseId)) return true;
    if (token === 'pick') {
      const rows = await loadStaffMyCourseRows(admin, telegramId);
      const { groupStaffCourseRows } = await import('@/lib/staff/course-assignment-ui');
      const group = groupStaffCourseRows(rows).find((g) => g.courseId === courseId);
      if (!group || group.roles.length < 2) return true;
      const { renderMyCourseRolePicker } = await import('./staff-my-course');
      const screen = renderMyCourseRolePicker(group.title, courseId);
      await editScreen(message, screen.text, screen.keyboard);
      return true;
    }
    const role = token as 'curator' | 'check';
    if (role !== 'curator' && role !== 'check') return true;
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

  if (parts[1] === 'sd' && parts[2] === 'ok' && parts[3] && parts[4]) {
    const courseId = Number(parts[3]);
    const lessonNum = Number(parts[4]);
    if (!Number.isFinite(courseId) || !Number.isFinite(lessonNum)) return true;
    const { getState, clearStateIfAvailable } = await import('@/lib/bot/admin/core');
    const { CURATOR_SCHEDULE_CONFIRM_STEP } = await import('./staff-steps');
    const { applyCuratorLessonSchedule } = await import('./curator-schedule-bot');
    const state = await getState(admin, telegramId).catch(() => null);
    const payload = state?.payload as CuratorSchedulePayloadExt & {
      pendingScheduledAtIso?: string;
      pendingLessonDate?: string;
    };
    if (
      String(state?.step) !== CURATOR_SCHEDULE_CONFIRM_STEP ||
      !payload?.sanityLessonId ||
      !payload.pendingScheduledAtIso ||
      !payload.pendingLessonDate
    ) {
      await editScreen(message, 'Подтверждение устарело. Выберите занятие снова.', {
        inline_keyboard: [[{ text: '⬅️ Назад', callback_data: `c:cal:${courseId}` }]],
      });
      return true;
    }
    try {
      await applyCuratorLessonSchedule(
        admin,
        payload.sanityLessonId,
        payload.pendingScheduledAtIso,
        payload.pendingLessonDate,
      );
      await clearStateIfAvailable(admin, telegramId);
      const when = formatLessonDateTimeRu(payload.pendingScheduledAtIso);
      await editScreen(message, `✅ Дата назначена.\n\n${payload.lessonTitle ?? 'Урок'}\n${when}`, {
        inline_keyboard: [[{ text: '⬅️ Расписание', callback_data: `c:cal:${courseId}` }]],
      });
    } catch (error) {
      await editScreen(message, error instanceof Error ? error.message : 'Не удалось сохранить.', {
        inline_keyboard: [[{ text: '⬅️ Назад', callback_data: `c:cal:${courseId}` }]],
      });
    }
    return true;
  }

  if (parts[1] === 'sd' && parts[2] === 'clr' && parts[3] && parts[4]) {
    const courseId = Number(parts[3]);
    const lessonNum = Number(parts[4]);
    if (!Number.isFinite(courseId) || !Number.isFinite(lessonNum)) return true;
    const loaded = await loadCuratorBotCabinet(admin, telegramId, courseId);
    if (!loaded) return true;
    const lesson = findLessonInCabinet(loaded.data, lessonNum);
    if (!lesson) return true;
    const { isSanityWriteConfigured, patchCourseLesson } = await import('@/lib/studio/courseContentWrite');
    if (!isSanityWriteConfigured()) {
      await editScreen(message, 'SANITY_API_WRITE_TOKEN не настроен.', {
        inline_keyboard: [[{ text: '⬅️ Назад', callback_data: `c:sd:${courseId}:${lessonNum}` }]],
      });
      return true;
    }
    await patchCourseLesson(lesson.sanityId, { scheduledAt: null, lessonDate: null });
    await editScreen(message, '✅ Дата занятия удалена.', {
      inline_keyboard: [[{ text: '⬅️ Расписание', callback_data: `c:cal:${courseId}` }]],
    });
    return true;
  }

  if (parts[1] === 'msg' && parts[2] === 'w' && parts[3]) {
    const studentTg = Number(parts[3]);
    if (Number.isFinite(studentTg)) {
      const { getStaffCourseWorkspace } = await import('./staff-course-session');
      const { openCuratorStudentDmTopicFromBot } = await import('./curator-dm-topic-open');
      const ws = await getStaffCourseWorkspace(admin, telegramId);
      await openCuratorStudentDmTopicFromBot(
        admin,
        telegramId,
        message.chatId,
        studentTg,
        ws?.role === 'curator' ? ws.courseId : undefined,
      );
      return true;
    }
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
    if (parts[3] === 'find') {
      try {
        const { CURATOR_STU_SEARCH_STEP } = await import('./staff-steps');
        await saveState(
          admin,
          telegramId,
          { chatId: message.chatId, messageId: message.messageId },
          CURATOR_STU_SEARCH_STEP as never,
          { courseId } as never,
        );
      } catch (error) {
        if (!isConversationStateTableError(error)) throw error;
        await sendAdminMessage(message.chatId, migrationText('bot_conversation_states.sql'));
        return true;
      }
      await editScreen(message, '🔎 Введите имя или часть имени ученика.', {
        inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: `c:stu:${courseId}` }]],
      });
      return true;
    }
    if (parts[3] === 'list') {
      const loaded = await loadCuratorBotCabinet(admin, telegramId, courseId);
      if (!loaded) return true;
      const { students } = await loadCuratorCourseStudents(admin, telegramId, {
        courseId,
        courseSlug: ctx.slug,
      });
      const q = getCuratorStudentSearchQuery(courseId, telegramId);
      const filtered = q
        ? students.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()))
        : students;
      const screen = renderCuratorStudentsList(courseId, loaded.data.courseTitle, filtered);
      await editScreen(message, screen.text, screen.keyboard);
      return true;
    }
    const loaded = await loadCuratorBotCabinet(admin, telegramId, courseId);
    if (!loaded) return true;
    const { students } = await loadCuratorCourseStudents(admin, telegramId, {
      courseId,
      courseSlug: ctx.slug,
    });
    clearCuratorStudentSearchQuery(courseId, telegramId);
    const screen = renderCuratorStudentsList(courseId, loaded.data.courseTitle, students);
    await editScreen(message, screen.text, screen.keyboard);
    return true;
  }

  if (parts[1] === 'sd' && parts[2] && parts[3] && parts[2] !== 'ok' && parts[2] !== 'clr') {
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
      const { resolveCuratorWebCabinetPath } = await import('@/lib/staff/staff-cabinet-access');
      const { getStaffCourseWorkspace } = await import('./staff-course-session');
      const ws = await getStaffCourseWorkspace(admin, telegramId);
      const path = await resolveCuratorWebCabinetPath(admin, telegramId, ws?.courseId ?? null);
      const url = await createCabinetLoginUrl(admin, telegramId, path);
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
