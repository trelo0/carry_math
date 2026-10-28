import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  type AdminMessage,
  type InlineKeyboard,
  editAdminMessage,
  sendAdminMessage,
} from '@/lib/bot/admin/core';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import { loadStaffCapabilities } from './capabilities';
import {
  COMBINED_STAFF_MENU_LABELS,
  isStaffMenuLabel,
  resolveStaffBotMode,
  staffGlobalReplyKeyboard,
  STAFF_COURSE_MANAGEMENT_LABEL,
} from './staff-menu';
import { renderCombinedLessonStudentsHub } from './staff-combined-screens';
import { loadTeacherBotSnapshot } from './teacher-data';
import {
  renderTeacherGroupList,
  renderTeacherIndividualList,
  renderTeacherScheduleHome,
  renderTeacherStudentsHub,
} from './teacher-screens';
import { renderTeacherHomeworkHub, renderTeacherMessagesInbox } from './teacher-messages-screens';
import { listTeacherThreads } from './messaging';
import {
  COMBINED_LESSON_STUDENTS_NAV,
  COMBINED_SCHEDULE_NAV,
  COMBINED_TEACHER_HW_NAV,
  COMBINED_TEACHER_MSG_NAV,
} from './staff-screen-nav';
import {
  loadStaffMyCourseRows,
  renderMyCourseListForFilter,
  renderMyCourseListScreen,
} from './staff-my-course';
import { teacherCabinetScreen } from '@/lib/bot/teacher/teacherFlow';

export const COMBINED_HOME_TEXT =
  '👋 Добро пожаловать в рабочий кабинет District!\n\n' +
  '🏫 Расписание, ученики, ДЗ и сообщения — ваши занятия как преподавателя.\n' +
  `🎓 «${STAFF_COURSE_MANAGEMENT_LABEL.slice(2)}» — онлайн-курсы по назначениям (куратор или проверка ДЗ).\n\n` +
  'Выберите раздел:';

async function combinedCabinetUrl(admin: SupabaseClient, telegramId: number): Promise<string | null> {
  try {
    const { resolveStaffCabinetLoginPath } = await import('@/lib/staff/staff-cabinet-access');
    const path = await resolveStaffCabinetLoginPath(admin, telegramId);
    return await createCabinetLoginUrl(admin, telegramId, path);
  } catch {
    return null;
  }
}

export async function sendStaffCourseOnlyStart(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
  testFooter = '',
): Promise<void> {
  const { clearStateIfAvailable } = await import('@/lib/bot/admin/core');
  await clearStateIfAvailable(admin, telegramId);
  const caps = await loadStaffCapabilities(admin, telegramId);
  const { STAFF_COURSE_HOME_TEXT } = await import('./staff-course-hub-flow');
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: STAFF_COURSE_HOME_TEXT + testFooter,
    reply_markup: staffGlobalReplyKeyboard(caps),
  });
}

export async function sendCombinedStaffStart(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
  testFooter = '',
): Promise<void> {
  const { clearStateIfAvailable } = await import('@/lib/bot/admin/core');
  await clearStateIfAvailable(admin, telegramId);
  const caps = await loadStaffCapabilities(admin, telegramId);
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: COMBINED_HOME_TEXT + testFooter,
    reply_markup: staffGlobalReplyKeyboard(caps),
  });
}

/** true, если отправлен staff start (не вызывать отдельный teacher/curator start). */
export async function sendStaffStart(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
  testFooter = '',
): Promise<boolean> {
  const caps = await loadStaffCapabilities(admin, telegramId);
  const mode = resolveStaffBotMode(caps);
  if (!mode || mode === 'teacher_only') return false;
  if (mode === 'course_staff_only' || mode === 'check_only' || mode === 'curator_only') {
    await sendStaffCourseOnlyStart(admin, chatId, telegramId, testFooter);
    return true;
  }
  if (mode === 'combined') {
    await sendCombinedStaffStart(admin, chatId, telegramId, testFooter);
    return true;
  }
  return false;
}

export async function handleCombinedStaffMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  const caps = await loadStaffCapabilities(admin, telegramId);
  const mode = resolveStaffBotMode(caps);
  if (mode === 'course_staff_only' || mode === 'check_only' || mode === 'curator_only') {
    if (text === STAFF_COURSE_MANAGEMENT_LABEL || text === '🎓 Курс') {
      const { sendStaffCourseManagementList } = await import('./staff-course-hub-flow');
      await sendStaffCourseManagementList(admin, chatId, telegramId);
      return true;
    }
    return false;
  }
  if (mode !== 'combined') return false;
  if (!isStaffMenuLabel(text, caps)) return false;

  const cabinetUrl = await combinedCabinetUrl(admin, telegramId);

  if (text === COMBINED_STAFF_MENU_LABELS.cabinet) {
    const screen = await teacherCabinetScreen(admin, telegramId);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === COMBINED_STAFF_MENU_LABELS.schedule) {
    const snapshot = await loadTeacherBotSnapshot(admin, telegramId);
    const screen = renderTeacherScheduleHome(snapshot, COMBINED_SCHEDULE_NAV);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === COMBINED_STAFF_MENU_LABELS.students) {
    const snapshot = await loadTeacherBotSnapshot(admin, telegramId);
    const screen = renderTeacherStudentsHub(snapshot);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === COMBINED_STAFF_MENU_LABELS.homework) {
    const screen = renderTeacherHomeworkHub(cabinetUrl, COMBINED_TEACHER_HW_NAV);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === COMBINED_STAFF_MENU_LABELS.messages) {
    const { threads, storageEnabled } = await listTeacherThreads(admin, telegramId);
    const screen = renderTeacherMessagesInbox(threads, storageEnabled, cabinetUrl, COMBINED_TEACHER_MSG_NAV);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === COMBINED_STAFF_MENU_LABELS.myCourse || text === STAFF_COURSE_MANAGEMENT_LABEL || text === '🎓 Курс') {
    const { sendStaffCourseManagementList } = await import('./staff-course-hub-flow');
    await sendStaffCourseManagementList(admin, chatId, telegramId);
    return true;
  }
  return false;
}

async function editCombinedScreen(message: AdminMessage, text: string, keyboard: InlineKeyboard): Promise<void> {
  await editAdminMessage(message, text, keyboard);
}

export async function handleCombinedStaffCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!data.startsWith('s:')) return false;
  const caps = await loadStaffCapabilities(admin, telegramId);
  const mode = resolveStaffBotMode(caps);
  if (mode !== 'combined') return false;

  const message: AdminMessage = { chatId, messageId };
  const parts = data.split(':');
  const [, action, sub] = parts;
  const cabinetUrl = await combinedCabinetUrl(admin, telegramId);
  let handled = false;

  switch (action) {
    case 'menu': {
      await editCombinedScreen(message, COMBINED_HOME_TEXT, { inline_keyboard: [] });
      handled = true;
      break;
    }
    case 'sch': {
      if (sub === 'c') {
        const rows = await loadStaffMyCourseRows(admin, telegramId);
        const screen = renderMyCourseListForFilter(rows, 'curator-tools');
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
        break;
      }
      if (sub === 't' || !sub) {
        const snapshot = await loadTeacherBotSnapshot(admin, telegramId);
        const screen = renderTeacherScheduleHome(snapshot, COMBINED_SCHEDULE_NAV);
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
        break;
      }
      break;
    }
    case 'stu': {
      if (sub === 'c') {
        const rows = await loadStaffMyCourseRows(admin, telegramId);
        const screen = renderMyCourseListForFilter(rows, 'curator-tools');
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
        break;
      }
      if (sub === 'les') {
        const hub = renderCombinedLessonStudentsHub(cabinetUrl);
        await editCombinedScreen(message, hub.text, hub.keyboard);
        handled = true;
        break;
      }
      if (sub === 'i') {
        const snapshot = await loadTeacherBotSnapshot(admin, telegramId);
        const screen = renderTeacherIndividualList(snapshot, COMBINED_LESSON_STUDENTS_NAV);
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
        break;
      }
      if (sub === 'g') {
        const snapshot = await loadTeacherBotSnapshot(admin, telegramId);
        const screen = renderTeacherGroupList(snapshot, COMBINED_LESSON_STUDENTS_NAV);
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
        break;
      }
      {
        const snapshot = await loadTeacherBotSnapshot(admin, telegramId);
        const screen = renderTeacherStudentsHub(snapshot);
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
      }
      break;
    }
    case 'hw': {
      if (sub === 'c') {
        const rows = await loadStaffMyCourseRows(admin, telegramId);
        const screen = renderMyCourseListForFilter(rows, 'homework');
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
        break;
      }
      if (sub === 't' || !sub) {
        const screen = renderTeacherHomeworkHub(cabinetUrl, COMBINED_TEACHER_HW_NAV);
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
        break;
      }
      break;
    }
    case 'msg': {
      if (sub === 'c') {
        const { staffDmTopicsEnabled } = await import('./dm-topics');
        if (staffDmTopicsEnabled()) {
          const { curatorCourseMessagesTopicsHint } = await import('./curator-dm-topic-open');
          await editCombinedScreen(message, curatorCourseMessagesTopicsHint(), {
            inline_keyboard: [[{ text: '⬅️ Главное меню', callback_data: 's:menu' }]],
          });
        } else {
          const rows = await loadStaffMyCourseRows(admin, telegramId);
          const screen = renderMyCourseListForFilter(rows, 'curator-tools');
          await editCombinedScreen(message, screen.text, screen.keyboard);
        }
        handled = true;
        break;
      }
      if (sub === 't' || !sub) {
        const { threads, storageEnabled } = await listTeacherThreads(admin, telegramId);
        const screen = renderTeacherMessagesInbox(threads, storageEnabled, cabinetUrl, COMBINED_TEACHER_MSG_NAV);
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
        break;
      }
      break;
    }
    default:
      break;
  }

  if (handled && callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }
  return handled;
}
