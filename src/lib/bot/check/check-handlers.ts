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
import {
  approveCourseHomeworkByCurator,
  rejectCourseHomeworkByCurator,
  addCourseHomeworkReviewComment,
  deductLifeForHomeworkDebtByChecker,
  CourseHomeworkError,
  formatLifeDeductionNote,
} from '@/lib/bot/education/course-homework';
import {
  getCuratorHomeworkRecord,
  getCuratorStudentRecord,
} from '@/lib/bot/curator/curatorData';
import { listCourseStudentTelegramIds } from '@/lib/curator/students';
import { notifyStudentHomeworkReviewed } from '@/lib/bot/studentHomeworkFlow';
import { sendSubmissionToCurator } from '@/lib/bot/studentHomeworkFlow';
import { getEnrollmentLives } from '@/lib/bot/education/lives';
import {
  deliverStaffToStudent,
  loadCheckThreadMessages,
  listCheckThreadsForCourse,
  markCheckThreadRead,
  staffStudentLabel,
} from '@/lib/bot/staff/messaging';
import { clearConflictingStaffStates } from '@/lib/bot/staff/staff-reply-state';
import { mergeWorkspaceIntoPayload } from '@/lib/bot/staff/staff-course-session';
import {
  CHECK_HW_COMMENT_STEP,
  CHECK_REJECT_PHOTO_STEP,
  CHECK_REJECT_TEXT_STEP,
  CHECK_REJECT_VOICE_STEP,
  CHECK_STU_SEARCH_STEP,
  STAFF_CHECK_REPLY_STEP,
} from '@/lib/bot/staff/staff-steps';
import { assertCheckCourseAccess, CheckAccessError } from './check-access';
import {
  collectCheckArchive,
  collectCheckPending,
  clearCheckStudentSearchQuery,
  filterStudentsByName,
  getCheckStudentSearchQuery,
  loadCheckHomeworkStudents,
  loadCheckStudentViews,
  loadCourseModuleLessonMap,
} from './check-data';
import {
  attachMetaToQueueItems,
  applyCheckHwFilters,
  CHECK_LIST_PAGE_SIZE,
  loadCheckHwMetaMap,
  paginateItems,
} from './check-homework-meta';
import { loadCheckCourseLibrary } from './check-library';
import {
  filterArchiveItems,
  renderCheckArchiveFilters,
  renderCheckHomeworkCard,
  renderCheckHomeworkHub,
  renderCheckHomeworkList,
  renderCheckHwFilterMenu,
  parseListFilters,
  renderCheckLibraryModules,
  renderCheckLibraryTasks,
  renderCheckLibraryWebinars,
  renderCheckLifeConfirm,
  renderCheckMessageThread,
  renderCheckMessagesInbox,
  renderCheckRejectMethod,
  renderCheckStudentCard,
  renderCheckStudentsList,
  type CheckArchiveFilter,
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

async function buildHomeworkQueueContext(
  admin: SupabaseClient,
  checkTelegramId: number,
  courseId: number,
) {
  const loaded = await loadCheckHomeworkStudents(admin, checkTelegramId, courseId);
  const metaMap = await loadCheckHwMetaMap(admin, loaded.courseSlug, loaded.students);
  const moduleMap = await loadCourseModuleLessonMap(loaded.courseSlug);
  return { ...loaded, metaMap, moduleMap };
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
  if (section === 'hw') {
    const screen = renderCheckHomeworkHub(courseId, ctx.title);
    await editScreen(message, screen.text, screen.keyboard);
    return;
  }
  if (section === 'stu') {
    clearCheckStudentSearchQuery(courseId, telegramId);
    const { students } = await loadCheckStudentViews(admin, telegramId, courseId);
    const { pageItems, totalPages } = paginateItems(students, 0, CHECK_LIST_PAGE_SIZE);
    const screen = renderCheckStudentsList(courseId, ctx.title, pageItems, {
      page: 0,
      totalPages,
    });
    await editScreen(message, screen.text, screen.keyboard);
    return;
  }
  if (section === 'msg') {
    const studentIds = await listCourseStudentTelegramIds(admin, courseId);
    const { threads, storageEnabled } = await listCheckThreadsForCourse(
      admin,
      telegramId,
      courseId,
      studentIds,
    );
    const screen = renderCheckMessagesInbox(courseId, ctx.title, threads, storageEnabled);
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
      if (!courseId || !['hw', 'stu', 'msg', 'lib'].includes(section)) return true;
      await openSection(admin, message, chatId, telegramId, section, courseId);
      return true;
    }

    if (parts[1] === 'hw' && parts[2]) {
      const courseId = parseCourseId(parts[2]);
      if (!courseId) return true;
      const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
      const queueCtx = await buildHomeworkQueueContext(admin, telegramId, courseId);
      const { students, metaMap, moduleMap } = queueCtx;

      if (parts[3] === undefined || parts[3] === '') {
        const screen = renderCheckHomeworkHub(courseId, ctx.title);
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'fl') {
        const page = Number(parts[4] ?? 0) || 0;
        if (parts[5] === 's') {
          const pending = attachMetaToQueueItems(collectCheckPending(students), metaMap);
          const uniq = new Map<number, string>();
          for (const item of pending) {
            uniq.set(Number(item.studentId), item.studentName);
          }
          const keyboard: InlineKeyboard['inline_keyboard'] = [...uniq.entries()].map(([tg, name]) => [
            { text: name.slice(0, 58), callback_data: `k:hw:${courseId}:pend:${page}:s:${tg}` },
          ]);
          keyboard.push([{ text: '⬅️ Назад', callback_data: `k:hw:${courseId}:fl:${page}` }]);
          await editScreen(message, '👤 Выберите ученика:', { inline_keyboard: keyboard });
          return true;
        }
        if (parts[5] === 'm') {
          const lib = await loadCheckCourseLibrary(ctx.slug);
          const mods = lib?.modules ?? [];
          const keyboard: InlineKeyboard['inline_keyboard'] = mods.map((m) => [
            { text: m.title.slice(0, 58), callback_data: `k:hw:${courseId}:pend:${page}:m:${m.index}` },
          ]);
          keyboard.push([{ text: '⬅️ Назад', callback_data: `k:hw:${courseId}:fl:${page}` }]);
          await editScreen(message, '📂 Выберите модуль:', { inline_keyboard: keyboard });
          return true;
        }
        if (parts[5] === 'n') {
          const pending = attachMetaToQueueItems(collectCheckPending(students), metaMap);
          const nums = [...new Set(pending.map((i) => i.homework.number))].sort((a, b) => a - b);
          const keyboard: InlineKeyboard['inline_keyboard'] = nums.map((n) => [
            { text: `Занятие №${n}`, callback_data: `k:hw:${courseId}:pend:${page}:n:${n}` },
          ]);
          keyboard.push([{ text: '⬅️ Назад', callback_data: `k:hw:${courseId}:fl:${page}` }]);
          await editScreen(message, '📚 Выберите номер занятия:', { inline_keyboard: keyboard });
          return true;
        }
        const screen = renderCheckHwFilterMenu(courseId, page);
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'pend') {
        const page = Number(parts[4] ?? 0) || 0;
        const filters = parseListFilters(parts, 5);
        let items = attachMetaToQueueItems(collectCheckPending(students), metaMap);
        items = applyCheckHwFilters(items, filters, moduleMap);
        const { pageItems, totalPages } = paginateItems(items, page, CHECK_LIST_PAGE_SIZE);
        const screen = renderCheckHomeworkList(courseId, ctx.title, pageItems, 'pending', {
          page,
          totalPages,
          filters,
        });
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'a' && !parts[4]) {
        const screen = renderCheckArchiveFilters(courseId, ctx.title);
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'a' && parts[4]) {
        const filter = parts[4] as CheckArchiveFilter;
        const page = Number(parts[5] ?? 0) || 0;
        let items = attachMetaToQueueItems(collectCheckArchive(students), metaMap);
        items = filterArchiveItems(items, filter);
        const { pageItems, totalPages } = paginateItems(items, page, CHECK_LIST_PAGE_SIZE);
        const screen = renderCheckHomeworkList(courseId, ctx.title, pageItems, 'archive', {
          archiveFilter: filter,
          page,
          totalPages,
          listCallbackBase: `k:hw:${courseId}:a:${filter}`,
        });
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'i' && parts[4] && parts[5]) {
        const student = getCuratorStudentRecord(students, parts[4]);
        const hwNum = Number(parts[5]);
        const homework = student ? getCuratorHomeworkRecord(student, hwNum) : undefined;
        if (!student || !homework) {
          await editScreen(message, 'Работа не найдена.', { inline_keyboard: [] });
          return true;
        }
        const readOnly = homework.status === 'approved';
        const meta = metaMap.get(`${student.id}:${hwNum}`) ?? null;
        const screen = renderCheckHomeworkCard(courseId, ctx.title, student, homework, {
          readOnly,
          meta,
        });
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'v' && parts[4] && parts[5]) {
        const student = getCuratorStudentRecord(students, parts[4]);
        const hwNum = Number(parts[5]);
        const homework = student ? getCuratorHomeworkRecord(student, hwNum) : undefined;
        if (!student || !homework) {
          await sendAdminMessage(chatId, 'Работа не найдена.');
          return true;
        }
        await sendSubmissionToCurator(admin, telegramId, {
          studentName: student.name,
          lessonNumber: homework.number,
          title: homework.title,
          fileUrl: homework.submissionFileUrl,
          note: homework.submissionNote,
        });
        await sendAdminMessage(chatId, '📎 Работа ученика отправлена выше.', {
          inline_keyboard: [
            [{ text: '⬅️ Назад', callback_data: `k:hw:${courseId}:i:${student.id}:${hwNum}` }],
          ],
        });
        return true;
      }

      if (parts[3] === 'ok' && parts[4] && parts[5]) {
        const student = getCuratorStudentRecord(students, parts[4]);
        const hwNum = Number(parts[5]);
        if (!student) return true;
        try {
          const { lesson } = await approveCourseHomeworkByCurator(
            admin,
            telegramId,
            student.telegramId,
            hwNum,
            { courseId, courseSlug: ctx.slug },
          );
          await notifyStudentHomeworkReviewed(admin, student.telegramId, {
            lessonNumber: lesson.lessonNumber,
            title: lesson.title,
            approved: true,
          });
          const pending = collectCheckPending(
            (await loadCheckHomeworkStudents(admin, telegramId, courseId)).students,
          );
          const next = pending[0];
          const lines = [`✅ ДЗ №${hwNum} одобрено (${student.name}).`];
          const keyboard: InlineKeyboard = { inline_keyboard: [] };
          if (next) {
            lines.push('', 'Следующая работа на проверке:');
            keyboard.inline_keyboard = [
              [
                {
                  text: `${next.studentName} · ДЗ №${next.homework.number}`,
                  callback_data: `k:hw:${courseId}:i:${next.studentId}:${next.homework.number}`,
                },
              ],
              [{ text: '⬅️ К списку', callback_data: `k:hw:${courseId}:p` }],
            ];
          } else {
            keyboard.inline_keyboard = [[{ text: '⬅️ К списку', callback_data: `k:hw:${courseId}:p` }]];
          }
          await sendAdminMessage(chatId, lines.join('\n'), keyboard);
        } catch (error) {
          const msg = error instanceof CourseHomeworkError ? error.message : 'Не удалось одобрить.';
          await sendAdminMessage(chatId, msg);
        }
        return true;
      }

      if (parts[3] === 'rej' && parts[4] && parts[5]) {
        const screen = renderCheckRejectMethod(courseId, parts[4], Number(parts[5]));
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'cmt' && parts[4] && parts[5]) {
        const studentId = parts[4];
        const hwNum = Number(parts[5]);
        try {
          await clearConflictingStaffStates(admin, telegramId, 'curator_reply');
          const promptId = await sendAdminMessage(
            chatId,
            '💬 Комментарий к работе (статус не изменится).\n\nНапишите текст.\n\n⬅️ Отмена',
            {
              inline_keyboard: [
                [{ text: '⬅️ Отмена', callback_data: `k:hw:${courseId}:i:${studentId}:${hwNum}` }],
              ],
            },
          );
          await saveState(
            admin,
            telegramId,
            { chatId, messageId: promptId ?? 0 },
            CHECK_HW_COMMENT_STEP as never,
            (await checkDialogPayload(admin, telegramId, {
              courseId,
              studentId,
              hwNumber: hwNum,
            })) as never,
          );
        } catch (error) {
          if (!isConversationStateTableError(error)) throw error;
          await sendAdminMessage(chatId, migrationText('bot_conversation_states.sql'));
        }
        return true;
      }
    }

    if (parts[1] === 'rej' && parts[2] && parts[3]) {
      const courseId = parseCourseId(parts[2]);
      if (!courseId) return true;
      const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
      const { students } = await loadCheckHomeworkStudents(admin, telegramId, courseId);

      if (parts[3] === 't' && parts[4] && parts[5]) {
        const studentId = parts[4];
        const hwNum = Number(parts[5]);
        try {
          await clearConflictingStaffStates(admin, telegramId, 'curator_reply');
          const promptId = await sendAdminMessage(
            chatId,
            '✏️ Комментарий для доработки.\n\n⬅️ Отмена',
            {
              inline_keyboard: [
                [{ text: '⬅️ Отмена', callback_data: `k:hw:${courseId}:i:${studentId}:${hwNum}` }],
              ],
            },
          );
          await saveState(
            admin,
            telegramId,
            { chatId, messageId: promptId ?? 0 },
            CHECK_REJECT_TEXT_STEP as never,
            (await checkDialogPayload(admin, telegramId, {
              courseId,
              studentId,
              hwNumber: hwNum,
            })) as never,
          );
        } catch (error) {
          if (!isConversationStateTableError(error)) throw error;
          await sendAdminMessage(chatId, migrationText('bot_conversation_states.sql'));
        }
        return true;
      }

      if ((parts[3] === 'v' || parts[3] === 'p') && parts[4] && parts[5]) {
        const studentId = parts[4];
        const hwNum = Number(parts[5]);
        const step = parts[3] === 'v' ? CHECK_REJECT_VOICE_STEP : CHECK_REJECT_PHOTO_STEP;
        const hint =
          parts[3] === 'v'
            ? '🎤 Отправьте голосовое с комментарием для доработки.'
            : '📷 Отправьте фото с комментарием для доработки.';
        try {
          await clearConflictingStaffStates(admin, telegramId, 'curator_reply');
          const promptId = await sendAdminMessage(chatId, `${hint}\n\n⬅️ Отмена`, {
            inline_keyboard: [
              [{ text: '⬅️ Отмена', callback_data: `k:hw:${courseId}:i:${studentId}:${hwNum}` }],
            ],
          });
          await saveState(
            admin,
            telegramId,
            { chatId, messageId: promptId ?? 0 },
            step as never,
            (await checkDialogPayload(admin, telegramId, {
              courseId,
              studentId,
              hwNumber: hwNum,
            })) as never,
          );
        } catch (error) {
          if (!isConversationStateTableError(error)) throw error;
          await sendAdminMessage(chatId, migrationText('bot_conversation_states.sql'));
        }
        return true;
      }

      if (parts[3] === 'skip' && parts[4] && parts[5]) {
        const student = getCuratorStudentRecord(students, parts[4]);
        const hwNum = Number(parts[5]);
        if (!student) return true;
        try {
          const { lesson } = await rejectCourseHomeworkByCurator(
            admin,
            telegramId,
            student.telegramId,
            hwNum,
            undefined,
            { courseId, courseSlug: ctx.slug },
          );
          await notifyStudentHomeworkReviewed(admin, student.telegramId, {
            lessonNumber: lesson.lessonNumber,
            title: lesson.title,
            approved: false,
          });
          await sendAdminMessage(chatId, `🔄 ДЗ №${hwNum} отправлено на доработку (${student.name}).`, {
            inline_keyboard: [
              [{ text: '⬅️ К работе', callback_data: `k:hw:${courseId}:i:${student.id}:${hwNum}` }],
            ],
          });
        } catch (error) {
          const msg = error instanceof CourseHomeworkError ? error.message : 'Не удалось вернуть на доработку.';
          await sendAdminMessage(chatId, msg);
        }
        return true;
      }
    }

    if (parts[1] === 'life' && parts[2]) {
      const courseId = parseCourseId(parts[2]);
      if (!courseId) return true;
      const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
      const { students } = await loadCheckHomeworkStudents(admin, telegramId, courseId);

      if (parts[3] === 'ask' && parts[4] && parts[5]) {
        const student = getCuratorStudentRecord(students, parts[4]);
        const hwNum = Number(parts[5]);
        const homework = student ? getCuratorHomeworkRecord(student, hwNum) : undefined;
        if (!student || !homework) return true;
        const lives = await getEnrollmentLives(admin, student.telegramId, courseId);
        const screen = renderCheckLifeConfirm(
          courseId,
          ctx.title,
          student.name,
          hwNum,
          student.id,
          lives?.lives_current ?? 0,
          lives?.lives_max ?? null,
        );
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'do' && parts[4] && parts[5]) {
        const student = getCuratorStudentRecord(students, parts[4]);
        const hwNum = Number(parts[5]);
        const homework = student ? getCuratorHomeworkRecord(student, hwNum) : undefined;
        if (!student || !homework) return true;
        try {
          const { lifeDeduction } = await deductLifeForHomeworkDebtByChecker(
            admin,
            telegramId,
            student.telegramId,
            homework.sanityLessonId,
            'overdue',
            { courseId, courseSlug: ctx.slug },
          );
          const note = lifeDeduction?.deducted
            ? `❤️ Жизнь снята за ДЗ №${hwNum}.`
            : lifeDeduction
              ? 'Жизнь за это ДЗ уже была снята ранее.'
              : 'Не удалось обновить жизни.';
          await sendAdminMessage(
            chatId,
            `${note}${formatLifeDeductionNote(lifeDeduction)}`,
            {
              inline_keyboard: [
                [{ text: '⬅️ Назад', callback_data: `k:hw:${courseId}:i:${student.id}:${hwNum}` }],
              ],
            },
          );
        } catch (error) {
          const msg = error instanceof CourseHomeworkError ? error.message : 'Не удалось снять жизнь.';
          await sendAdminMessage(chatId, msg);
        }
        return true;
      }
    }

    if (parts[1] === 'stu' && parts[2]) {
      const courseId = parseCourseId(parts[2]);
      if (!courseId) return true;
      const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
      if (parts[3] === undefined || parts[3] === 'pg') {
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
          const promptId = await sendAdminMessage(chatId, '🔎 Введите имя или часть имени ученика.\n\n⬅️ Отмена', {
            inline_keyboard: [[{ text: '⬅️ Отмена', callback_data: `k:stu:${courseId}` }]],
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
        const { threads, storageEnabled } = await listCheckThreadsForCourse(
          admin,
          telegramId,
          courseId,
          studentIds,
        );
        const screen = renderCheckMessagesInbox(courseId, ctx.title, threads, storageEnabled);
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
    const msg = error instanceof CheckAccessError ? error.message : 'Ошибка доступа.';
    await editScreen(message, msg, { inline_keyboard: [] });
    return true;
  }

  return true;
}
