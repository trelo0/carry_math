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
  COMBINED_STAFF_MENU_LABEL_SET,
  resolveStaffBotMode,
  staffReplyKeyboard,
} from './staff-menu';
import {
  renderCombinedHomeworkHub,
  renderCombinedMessagesHub,
  renderCombinedStudentsHub,
} from './staff-combined-screens';
import { loadTeacherBotSnapshot } from './teacher-data';
import {
  renderTeacherGroupList,
  renderTeacherIndividualList,
  renderTeacherScheduleHome,
} from './teacher-screens';
import { renderTeacherHomeworkHub, renderTeacherMessagesInbox } from './teacher-messages-screens';
import { listTeacherThreads, listCuratorThreads } from './messaging';
import { loadCuratorActivitySnapshot } from './curator-activity-data';
import { renderCuratorActivityHome } from './curator-activity-screens';
import { renderCuratorHomeworkHub } from './curator-homework-screens';
import { renderCuratorMessagesInbox } from './curator-messages-screens';
import {
  COMBINED_CURATOR_COURSE_NAV,
  COMBINED_CURATOR_HW_NAV,
  COMBINED_CURATOR_MSG_NAV,
  COMBINED_STUDENTS_NAV,
  COMBINED_TEACHER_HW_NAV,
  COMBINED_TEACHER_MSG_NAV,
} from './staff-screen-nav';
import { loadCuratorStudents } from '@/lib/bot/curator/curatorData';
import { renderCuratorStudentsList } from '@/lib/bot/curator/curatorFlow';
import { teacherCabinetScreen } from '@/lib/bot/teacher/teacherFlow';

export const COMBINED_HOME_TEXT =
  '👋 Добро пожаловать в рабочий кабинет District!\n\n' +
  'Здесь вы можете посмотреть своих учеников, расписание, домашние задания и сообщения.\n\n' +
  'Выберите нужный раздел:';

async function combinedCabinetUrl(admin: SupabaseClient, telegramId: number): Promise<string | null> {
  try {
    return await createCabinetLoginUrl(admin, telegramId, '/cabinet/staff');
  } catch {
    return null;
  }
}

export async function sendCombinedStaffStart(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
  testFooter = '',
): Promise<void> {
  const caps = await loadStaffCapabilities(admin, telegramId);
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: COMBINED_HOME_TEXT + testFooter,
    reply_markup: staffReplyKeyboard(caps),
  });
}

/** true, если отправлено combined/ staff start (не вызывать teacher/curator start). */
export async function sendStaffStart(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
  testFooter = '',
): Promise<boolean> {
  const caps = await loadStaffCapabilities(admin, telegramId);
  if (resolveStaffBotMode(caps) !== 'combined') return false;
  await sendCombinedStaffStart(admin, chatId, telegramId, testFooter);
  return true;
}

export async function handleCombinedStaffMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  const caps = await loadStaffCapabilities(admin, telegramId);
  if (resolveStaffBotMode(caps) !== 'combined') return false;
  if (!COMBINED_STAFF_MENU_LABEL_SET.has(text)) return false;

  const cabinetUrl = await combinedCabinetUrl(admin, telegramId);

  if (text === COMBINED_STAFF_MENU_LABELS.cabinet) {
    const screen = await teacherCabinetScreen(admin, telegramId);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === COMBINED_STAFF_MENU_LABELS.schedule) {
    const snapshot = await loadTeacherBotSnapshot(admin, telegramId);
    const screen = renderTeacherScheduleHome(snapshot);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === COMBINED_STAFF_MENU_LABELS.students) {
    const screen = renderCombinedStudentsHub(cabinetUrl);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === COMBINED_STAFF_MENU_LABELS.homework) {
    const screen = renderCombinedHomeworkHub(cabinetUrl);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === COMBINED_STAFF_MENU_LABELS.messages) {
    const screen = renderCombinedMessagesHub(cabinetUrl);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
    return true;
  }
  if (text === COMBINED_STAFF_MENU_LABELS.course) {
    const snapshot = await loadCuratorActivitySnapshot(admin, telegramId);
    const screen = renderCuratorActivityHome(snapshot, cabinetUrl, COMBINED_CURATOR_COURSE_NAV);
    await sendAdminMessage(chatId, screen.text, screen.keyboard);
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
  if (resolveStaffBotMode(caps) !== 'combined') return false;

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
    case 'stu': {
      if (sub === 'c') {
        const students = await loadCuratorStudents(admin, telegramId);
        const screen = renderCuratorStudentsList(students, COMBINED_STUDENTS_NAV);
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
        break;
      }
      if (sub === 'i') {
        const snapshot = await loadTeacherBotSnapshot(admin, telegramId);
        const screen = renderTeacherIndividualList(snapshot, COMBINED_STUDENTS_NAV);
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
        break;
      }
      if (sub === 'g') {
        const snapshot = await loadTeacherBotSnapshot(admin, telegramId);
        const screen = renderTeacherGroupList(snapshot, COMBINED_STUDENTS_NAV);
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
        break;
      }
      const hub = renderCombinedStudentsHub(cabinetUrl);
      await editCombinedScreen(message, hub.text, hub.keyboard);
      handled = true;
      break;
    }
    case 'hw': {
      if (sub === 't') {
        const screen = renderTeacherHomeworkHub(cabinetUrl, COMBINED_TEACHER_HW_NAV);
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
        break;
      }
      if (sub === 'c') {
        const screen = renderCuratorHomeworkHub(cabinetUrl, COMBINED_CURATOR_HW_NAV);
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
        break;
      }
      const hub = renderCombinedHomeworkHub(cabinetUrl);
      await editCombinedScreen(message, hub.text, hub.keyboard);
      handled = true;
      break;
    }
    case 'msg': {
      if (sub === 't') {
        const { threads, storageEnabled } = await listTeacherThreads(admin, telegramId);
        const screen = renderTeacherMessagesInbox(threads, storageEnabled, cabinetUrl, COMBINED_TEACHER_MSG_NAV);
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
        break;
      }
      if (sub === 'c') {
        const { threads, storageEnabled } = await listCuratorThreads(admin, telegramId);
        const screen = renderCuratorMessagesInbox(threads, storageEnabled, cabinetUrl, COMBINED_CURATOR_MSG_NAV);
        await editCombinedScreen(message, screen.text, screen.keyboard);
        handled = true;
        break;
      }
      const hub = renderCombinedMessagesHub(cabinetUrl);
      await editCombinedScreen(message, hub.text, hub.keyboard);
      handled = true;
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
