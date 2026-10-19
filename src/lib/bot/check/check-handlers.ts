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
import { telegramSend } from '@/lib/telegram';
import { getEnrollmentLives } from '@/lib/bot/education/lives';
import { notifyAdminsHomeworkOverdue } from '@/lib/bot/education/homework-deadline-notify';
import { listCourseStudentTelegramIds } from '@/lib/curator/students';
import {
  loadCheckThreadMessages,
  listCheckThreadsForCourse,
  markCheckThreadRead,
  staffStudentLabel,
} from '@/lib/bot/staff/messaging';
import { clearConflictingStaffStates } from '@/lib/bot/staff/staff-reply-state';
import { mergeWorkspaceIntoPayload, resetStaffDialogKeepWorkspace } from '@/lib/bot/staff/staff-course-session';
import { CHECK_STU_SEARCH_STEP, STAFF_CHECK_REPLY_STEP } from '@/lib/bot/staff/staff-steps';
import { assertCheckCourseAccess, CheckAccessError } from './check-access';
import { handleCheckHomeworkFamily, originToPayload } from './check-hw-callbacks';
import {
  clearCheckStudentSearchQuery,
  filterStudentsByName,
  getCheckStudentSearchQuery,
  loadCheckHomeStats,
  loadCheckStudentViews,
} from './check-data';
import { CHECK_LIST_PAGE_SIZE, paginateItems } from './check-homework-meta';
import { loadCheckCourseLibrary } from './check-library';
import {
  encodeHwItemCallback,
  parseOriginFromParts,
  renderCheckHome,
  renderCheckHomeworkHub,
  renderCheckLibraryModules,
  renderCheckLibraryTasks,
  renderCheckLibraryWebinars,
  renderCheckMessageThread,
  renderCheckMessagesHub,
  renderCheckMessagesInbox,
  renderCheckIncomingPreview,
  renderCheckStudentCard,
  renderCheckStudentsHub,
  renderCheckStudentsList,
  type CheckBotSection,
} from './check-screens';

async function editScreen(message: AdminMessage, text: string, keyboard: InlineKeyboard) {
  await editAdminMessage(message, text, keyboard);
}

async function checkDialogPayload(
  admin: SupabaseClient,
  telegramId: number,
  base: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return mergeWorkspaceIntoPayload(admin, telegramId, base);
}

function parseCourseId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function openSection(
  admin: SupabaseClient,
  message: AdminMessage,
  chatId: number,
  telegramId: number,
  section: CheckBotSection,
  courseId: number,
): Promise<void> {
  const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
  await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
  if (section === 'home') {
    const stats = await loadCheckHomeStats(admin, telegramId, courseId);
    const screen = renderCheckHome(courseId, ctx.title, stats);
    await editScreen(message, screen.text, screen.keyboard);
    return;
  }
  if (section === 'hw') {
    const screen = renderCheckHomeworkHub(courseId, ctx.title);
    await editScreen(message, screen.text, screen.keyboard);
    return;
  }
  if (section === 'stu') {
    clearCheckStudentSearchQuery(courseId, telegramId);
    const screen = renderCheckStudentsHub(courseId, ctx.title);
    await editScreen(message, screen.text, screen.keyboard);
    return;
  }
  if (section === 'msg') {
    const studentIds = await listCourseStudentTelegramIds(admin, courseId);
    const { threads } = await listCheckThreadsForCourse(admin, telegramId, courseId, studentIds);
    const incoming = threads.filter((t) => t.unreadCount > 0).length;
    const screen = renderCheckMessagesHub(courseId, ctx.title, incoming);
    await editScreen(message, screen.text, screen.keyboard);
    return;
  }
  const lib = await loadCheckCourseLibrary(ctx.slug);
  const screen = renderCheckLibraryModules(courseId, ctx.title, lib?.modules ?? []);
  await editScreen(message, screen.text, screen.keyboard);
}

export async function handleCheckBotCallback(
  admin: SupabaseClient,
  message: AdminMessage,
  telegramId: number,
  data: string,
): Promise<boolean> {
  if (!data.startsWith('k:')) return false;
  const parts = data.split(':');
  const chatId = message.chatId;

  try {
    if (parts[1] === 'sec' && parts[2] && parts[3]) {
      const section = parts[2] as CheckBotSection;
      const courseId = parseCourseId(parts[3]);
      if (!courseId || !['home', 'hw', 'stu', 'msg', 'lib'].includes(section)) return true;
      await openSection(admin, message, chatId, telegramId, section, courseId);
      return true;
    }

    if (parts[1] === 'home' && parts[2]) {
      const courseId = parseCourseId(parts[2]);
      if (!courseId) return true;
      await openSection(admin, message, chatId, telegramId, 'home', courseId);
      return true;
    }

    if (parts[1] === 'ntf' && parts[2] === 'close') {
      const deleted = await telegramSend('deleteMessage', {
        chat_id: message.chatId,
        message_id: message.messageId,
      });
      if (!deleted.ok) {
        await editScreen(message, '☑️ Уведомление скрыто.', { inline_keyboard: [] });
      }
      return true;
    }

    if (parts[1] === 'od' && parts[2] === 'adm' && parts[3] && parts[4]) {
      const courseId = parseCourseId(parts[3]);
      const studentTelegramId = Number(parts[4]);
      const hwNum = Number(parts[5] ?? 0);
      if (!courseId || !Number.isFinite(studentTelegramId)) return true;
      const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
      const label = await staffStudentLabel(admin, studentTelegramId);
      const lives = await getEnrollmentLives(admin, studentTelegramId, courseId).catch(() => null);
      const overdueText = [
        '⏰ Просрочено домашнее задание',
        '',
        `👤 ${label}`,
        `🎓 ${ctx.title}`,
        ...(hwNum > 0 ? [`📝 ДЗ №${hwNum}`] : []),
        `❤️ Жизней: ${lives ? `${lives.lives_current} из ${lives.lives_max}` : '—'}`,
        '',
        'Переслано проверяющим ДЗ.',
      ].join('\n');
      await notifyAdminsHomeworkOverdue(admin, studentTelegramId, overdueText);
      await sendAdminMessage(chatId, '✅ Отправлено администратору.');
      return true;
    }

    if (parts[1] === 'hw' || parts[1] === 'rej' || parts[1] === 'life') {
      return handleCheckHomeworkFamily(admin, message, telegramId, parts);
    }


    if (parts[1] === 'stu' && parts[2]) {
      const courseId = parseCourseId(parts[2]);
      if (!courseId) return true;
      const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
      if (parts[3] === undefined) {
        clearCheckStudentSearchQuery(courseId, telegramId);
        await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
        const screen = renderCheckStudentsHub(courseId, ctx.title);
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (parts[3] === 'list' || parts[3] === 'pg') {
        const page = parts[3] === 'pg' ? Number(parts[4] ?? 0) || 0 : 0;
        const { students: all } = await loadCheckStudentViews(admin, telegramId, courseId);
        const q = getCheckStudentSearchQuery(courseId, telegramId);
        const filtered = q ? filterStudentsByName(all, q) : all;
        const { pageItems, totalPages } = paginateItems(filtered, page, CHECK_LIST_PAGE_SIZE);
        const screen = renderCheckStudentsList(courseId, ctx.title, pageItems, {
          page,
          totalPages,
          searchQuery: q ?? null,
        });
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }
      if (parts[3] === 'find') {
        try {
          const promptId = await sendAdminMessage(chatId, '🔎 Введите имя или часть имени ученика.', {
            inline_keyboard: [[{ text: '⬅️ Назад', callback_data: `k:stu:${courseId}` }]],
          });
          await saveState(
            admin,
            telegramId,
            { chatId, messageId: promptId ?? 0 },
            CHECK_STU_SEARCH_STEP as never,
            (await checkDialogPayload(admin, telegramId, { courseId })) as never,
          );
        } catch (error) {
          if (!isConversationStateTableError(error)) throw error;
          await sendAdminMessage(chatId, migrationText('bot_conversation_states.sql'));
        }
        return true;
      }
      if (parts[3] === 's' && parts[4]) {
        const tg = Number(parts[4]);
        const { students } = await loadCheckStudentViews(admin, telegramId, courseId);
        const student = students.find((s) => s.telegramId === tg);
        if (!student) {
          await editScreen(message, 'Ученик не найден.', { inline_keyboard: [] });
          return true;
        }
        const screen = renderCheckStudentCard(courseId, ctx.title, student);
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }
    }

    if (parts[1] === 'msg' && parts[2]) {
      const courseId = parseCourseId(parts[2]);
      if (!courseId) return true;
      const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
      const studentIds = await listCourseStudentTelegramIds(admin, courseId);

      if (parts[3] === undefined) {
        const { threads } = await listCheckThreadsForCourse(admin, telegramId, courseId, studentIds);
        const incoming = threads.filter(
          (t) => t.unreadCount > 0 || t.lastDirection === 'student_to_staff',
        ).length;
        const screen = renderCheckMessagesHub(courseId, ctx.title, incoming);
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'in' && parts[4] && parts[5] === 'ok') {
        const studentTelegramId = Number(parts[4]);
        await markCheckThreadRead(admin, telegramId, studentTelegramId, courseId);
        const { threads, storageEnabled } = await listCheckThreadsForCourse(
          admin,
          telegramId,
          courseId,
          studentIds,
        );
        const filtered = threads.filter(
          (t) => t.unreadCount > 0 || t.lastDirection === 'student_to_staff',
        );
        const screen = renderCheckMessagesInbox(
          courseId,
          ctx.title,
          filtered,
          storageEnabled,
          'incoming',
        );
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'in' && parts[4] && !parts[5]) {
        const studentTelegramId = Number(parts[4]);
        const { threads } = await listCheckThreadsForCourse(
          admin,
          telegramId,
          courseId,
          studentIds,
        );
        const thread = threads.find((t) => t.studentTelegramId === studentTelegramId);
        const label = thread?.studentLabel ?? (await staffStudentLabel(admin, studentTelegramId));
        const screen = renderCheckIncomingPreview(
          courseId,
          ctx.title,
          label,
          studentTelegramId,
          thread?.lastBody ?? '',
          thread?.lastAt ?? new Date().toISOString(),
        );
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'd' && parts[4]) {
        const studentTelegramId = Number(parts[4]);
        await markCheckThreadRead(admin, telegramId, studentTelegramId, courseId);
        const label = await staffStudentLabel(admin, studentTelegramId);
        const { messages, storageEnabled } = await loadCheckThreadMessages(
          admin,
          telegramId,
          studentTelegramId,
          courseId,
        );
        const screen = renderCheckMessageThread(
          courseId,
          ctx.title,
          label,
          messages,
          storageEnabled,
          studentTelegramId,
        );
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if ((parts[3] === 'in' || parts[3] === 'dlg') && !parts[4]) {
        const { threads, storageEnabled } = await listCheckThreadsForCourse(
          admin,
          telegramId,
          courseId,
          studentIds,
        );
        const mode = parts[3] === 'in' ? 'incoming' : 'dialogs';
        const filtered =
          mode === 'incoming'
            ? threads.filter(
                (t) => t.unreadCount > 0 || t.lastDirection === 'student_to_staff',
              )
            : threads;
        const screen = renderCheckMessagesInbox(courseId, ctx.title, filtered, storageEnabled, mode);
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'w' && parts[4]) {
        const studentTelegramId = Number(parts[4]);
        try {
          await clearConflictingStaffStates(admin, telegramId, 'curator_reply');
          const promptId = await sendAdminMessage(chatId, '✏️ Сообщение ученику.\n\n⬅️ Отмена', {
            inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: `k:msg:${courseId}:d:${studentTelegramId}` }]],
          });
          await saveState(
            admin,
            telegramId,
            { chatId, messageId: promptId ?? 0 },
            STAFF_CHECK_REPLY_STEP as never,
            (await checkDialogPayload(admin, telegramId, { courseId, studentTelegramId })) as never,
          );
        } catch (error) {
          if (!isConversationStateTableError(error)) throw error;
          await sendAdminMessage(chatId, migrationText('bot_conversation_states.sql'));
        }
        return true;
      }

      if (parts[3] === 'wh' && parts[4] && parts[5]) {
        const studentTelegramId = Number(parts[4]);
        const hwNum = Number(parts[5]);
        const origin = parseOriginFromParts(parts, 6);
        const studentId = String(studentTelegramId);
        try {
          await clearConflictingStaffStates(admin, telegramId, 'curator_reply');
          const promptId = await sendAdminMessage(chatId, '✏️ Сообщение ученику.\n\n⬅️ Назад', {
            inline_keyboard: [
              [
                {
                  text: '⬅️ Назад',
                  callback_data: encodeHwItemCallback('i', courseId, studentId, hwNum, origin),
                },
              ],
            ],
          });
          await saveState(
            admin,
            telegramId,
            { chatId, messageId: promptId ?? 0 },
            STAFF_CHECK_REPLY_STEP as never,
            (await checkDialogPayload(admin, telegramId, {
              courseId,
              studentTelegramId,
              studentId,
              hwNumber: hwNum,
              ...originToPayload(origin),
            })) as never,
          );
        } catch (error) {
          if (!isConversationStateTableError(error)) throw error;
          await sendAdminMessage(chatId, migrationText('bot_conversation_states.sql'));
        }
        return true;
      }
    }

    if (parts[1] === 'lib' && parts[2]) {
      const courseId = parseCourseId(parts[2]);
      if (!courseId) return true;
      const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
      const lib = await loadCheckCourseLibrary(ctx.slug);
      const modules = lib?.modules ?? [];

      if (parts[3] === undefined) {
        const screen = renderCheckLibraryModules(courseId, ctx.title, modules);
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'm' && parts[4] != null) {
        const modIdx = Number(parts[4]);
        const mod = modules.find((m) => m.index === modIdx);
        if (!mod) return true;
        const screen = renderCheckLibraryWebinars(courseId, mod.title, mod.index, mod.webinars);
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'w' && parts[4] != null && parts[5]) {
        const modIdx = Number(parts[4]);
        const webinarId = parts[5];
        const mod = modules.find((m) => m.index === modIdx);
        const webinar = mod?.webinars.find((w) => w.id === webinarId);
        if (!webinar || !mod) return true;
        const screen = renderCheckLibraryTasks(courseId, webinar.title, webinar.tasks, mod.index);
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }
    }
  } catch (error) {
    const msg =
      error instanceof CheckAccessError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Не удалось выполнить действие.';
    await editScreen(message, msg, { inline_keyboard: [] });
    return true;
  }

  return true;
}
