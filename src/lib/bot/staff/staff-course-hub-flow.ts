import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { editAdminMessage, sendAdminMessage, type AdminMessage } from '@/lib/bot/admin/core';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import { listStaffCourseAssignmentOptions } from '@/lib/curator/course-context';
import { loadStaffCapabilities } from './capabilities';
import {
  loadStaffMyCourseRows,
  renderMyCourseListScreen,
  type StaffCourseAssignmentRow,
} from './staff-my-course';
import {
  enterStaffCourseWorkspace,
  exitStaffCourseWorkspace,
  getStaffCourseWorkspace,
  type StaffCourseWorkspace,
} from './staff-course-session';
import {
  isStaffGlobalMenuLabel,
  isStaffWorkspaceMenuLabel,
  STAFF_COURSE_MANAGEMENT_LABEL,
  STAFF_EXIT_ALL_COURSES_LABEL,
  resolveStaffBotMode,
} from './staff-menu';
import { sendCuratorSectionForCourse } from './curator-bot-handlers';
import type { CuratorBotSection } from './curator-bot-screens';

export const STAFF_COURSE_HOME_TEXT =
  'Кабинет сотрудника District.\n\n' +
  '🎓 «Управление курсами» — работа с онлайн-курсами (куратор или проверка ДЗ).\n' +
  'Разделы курса доступны после выбора конкретного курса.';

export async function sendStaffCourseManagementList(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
): Promise<void> {
  const rows = await loadStaffMyCourseRows(admin, telegramId);
  const screen = renderMyCourseListScreen(rows, {
    backCallback: 'staff:hub:close',
    backLabel: '⬅️ Закрыть',
  });
  await sendAdminMessage(chatId, screen.text, screen.keyboard);
}

export async function tryAutoEnterSingleCourseWorkspace(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
): Promise<boolean> {
  const caps = await loadStaffCapabilities(admin, telegramId);
  const mode = resolveStaffBotMode(caps);
  if (mode !== 'course_staff_only' && mode !== 'check_only' && mode !== 'curator_only') {
    return false;
  }
  const rows = await loadStaffMyCourseRows(admin, telegramId);
  if (rows.length !== 1) return false;
  await enterStaffCourseWorkspaceFromRow(admin, telegramId, chatId, rows[0]!);
  return true;
}

export async function enterStaffCourseWorkspaceFromRow(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  row: StaffCourseAssignmentRow,
): Promise<void> {
  const options = await listStaffCourseAssignmentOptions(admin, telegramId);
  const hit = options.find((o) => o.courseId === row.courseId && o.role === row.role);
  const ws: StaffCourseWorkspace = {
    courseId: row.courseId,
    role: row.role,
    courseTitle: row.title,
    courseSlug: hit?.slug ?? '',
  };
  await enterStaffCourseWorkspace(admin, telegramId, chatId, ws);
}

export async function handleStaffGlobalMenuMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  const caps = await loadStaffCapabilities(admin, telegramId);
  if (!isStaffGlobalMenuLabel(text, caps)) return false;

  if (text === STAFF_COURSE_MANAGEMENT_LABEL || text === '🎓 Курс') {
    await sendStaffCourseManagementList(admin, chatId, telegramId);
    return true;
  }

  return false;
}

export async function handleStaffWorkspaceMenuMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  const ws = await getStaffCourseWorkspace(admin, telegramId);
  if (!ws) return false;
  if (!isStaffWorkspaceMenuLabel(text, ws.role)) return false;

  if (text === STAFF_EXIT_ALL_COURSES_LABEL) {
    await exitStaffCourseWorkspace(admin, telegramId, chatId);
    await sendStaffCourseManagementList(admin, chatId, telegramId);
    return true;
  }

  if (ws.role === 'curator') {
    const sectionMap: Record<string, CuratorBotSection> = {
      '📅 Расписание курса': 'cal',
      '📚 Занятия курса': 'les',
      '👥 Ученики курса': 'stu',
    };
    const section = sectionMap[text];
    if (section) {
      await sendCuratorSectionForCourse(admin, chatId, telegramId, section, ws.courseId);
      return true;
    }
    if (text === '🌐 Панель управления') {
      try {
        const { resolveCuratorWebCabinetPath } = await import('@/lib/staff/staff-cabinet-access');
        const path = await resolveCuratorWebCabinetPath(admin, telegramId, ws.courseId);
        const url = await createCabinetLoginUrl(admin, telegramId, path);
        await sendAdminMessage(chatId, '🌐 Кабинет на сайте:', {
          inline_keyboard: [[{ text: '🌐 Открыть кабинет', url }]],
        });
      } catch {
        await sendAdminMessage(chatId, 'Не удалось открыть ссылку на кабинет.');
      }
      return true;
    }
  }

  if (ws.role === 'check') {
    const { sendCheckSectionForCourse } = await import('@/lib/bot/check/check-flow');
    const { CHECK_BOT_MENU_LABELS } = await import('./staff-menu');
    const sectionMap = {
      [CHECK_BOT_MENU_LABELS.home]: 'home' as const,
      [CHECK_BOT_MENU_LABELS.homework]: 'hw' as const,
      [CHECK_BOT_MENU_LABELS.students]: 'stu' as const,
      [CHECK_BOT_MENU_LABELS.messages]: 'msg' as const,
      [CHECK_BOT_MENU_LABELS.library]: 'lib' as const,
    };
    const section = sectionMap[text as keyof typeof sectionMap];
    if (section) {
      await sendCheckSectionForCourse(admin, chatId, telegramId, section, ws.courseId);
      return true;
    }
  }

  return false;
}

export async function handleStaffCourseHubCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  const message: AdminMessage = { chatId, messageId };

  if (data === 'staff:hub:close') {
    if (callbackQueryId) {
      await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
    }
    return true;
  }

  if (data === 'c:mc' || data === 'c:hub') {
    const rows = await loadStaffMyCourseRows(admin, telegramId);
    const screen = renderMyCourseListScreen(rows);
    await editAdminMessage(message, screen.text, screen.keyboard);
    if (callbackQueryId) {
      await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
    }
    return true;
  }

  if (data.startsWith('c:mc:')) {
    const parts = data.split(':');
    const courseId = Number(parts[2]);
    const role = parts[3] as 'curator' | 'check';
    if (!Number.isFinite(courseId) || (role !== 'curator' && role !== 'check')) return false;

    const rows = await loadStaffMyCourseRows(admin, telegramId);
    const row = rows.find((r) => r.courseId === courseId && r.role === role);
    if (!row) {
      await editAdminMessage(message, 'Назначение не найдено.', { inline_keyboard: [] });
      if (callbackQueryId) {
        await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
      }
      return true;
    }

    await enterStaffCourseWorkspaceFromRow(admin, telegramId, chatId, row);
    if (callbackQueryId) {
      await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
    }
    return true;
  }

  return false;
}
