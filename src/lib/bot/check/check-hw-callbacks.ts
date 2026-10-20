import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminMessage, InlineKeyboard } from '@/lib/bot/admin/core';
import {
  clearStateIfAvailable,
  editAdminMessage,
  getState,
  isConversationStateTableError,
  migrationText,
  saveState,
  sendAdminMessage,
} from '@/lib/bot/admin/core';
import {
  addCourseHomeworkReviewComment,
  approveCourseHomeworkByCurator,
  CourseHomeworkError,
  deductLifeForHomeworkDebtByChecker,
  formatLifeDeductionNote,
  rejectCourseHomeworkByCurator,
} from '@/lib/bot/education/course-homework';
import {
  getCuratorHomeworkRecord,
  getCuratorStudentRecord,
} from '@/lib/bot/curator/curatorData';
import { notifyStudentHomeworkReviewed, sendSubmissionToCurator } from '@/lib/bot/studentHomeworkFlow';
import { getEnrollmentLives, hasLifeDeductedForLesson } from '@/lib/bot/education/lives';
import { clearConflictingStaffStates } from '@/lib/bot/staff/staff-reply-state';
import { mergeWorkspaceIntoPayload, resetStaffDialogKeepWorkspace } from '@/lib/bot/staff/staff-course-session';
import {
  CHECK_HW_COMMENT_STEP,
  CHECK_REJECT_COMMENT_STEP,
  CHECK_REJECT_CONFIRM_STEP,
  CHECK_REJECT_FILE_STEP,
} from '@/lib/bot/staff/staff-steps';
import {
  isPlaceholderReviewText,
  packHomeworkReviewNote,
} from '@/lib/bot/education/homework-review-note';
import { assertCheckCourseAccess } from './check-access';
import {
  collectCheckArchive,
  collectCheckPending,
  collectCheckQueue,
  loadCheckHomeworkStudents,
  loadCourseModuleLessonMap,
} from './check-data';
import {
  applyCheckHwFilters,
  attachMetaToQueueItems,
  CHECK_LIST_PAGE_SIZE,
  loadCheckHwMetaMap,
  paginateItems,
  type CheckHomeworkListItem,
  type CheckHwListFilters,
} from './check-homework-meta';
import {
  encodeHwItemCallback,
  parseListFilters,
  parseOriginFromParts,
  renderCheckArchiveStatusFilters,
  renderCheckHomeworkCard,
  renderCheckHomeworkHub,
  renderCheckHomeworkList,
  renderCheckHwFilterMenu,
  renderCheckLifeConfirm,
  renderCheckRejectCommentPrompt,
  renderCheckRejectDraftConfirm,
  renderCheckRejectFilePrompt,
  renderCheckRejectNotePrompt,
  renderCheckRejectSkipConfirm,
  renderCheckVerdict,
  type CheckHwListMode,
  type CheckHwListOrigin,
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

export function originFromPayload(payload: Record<string, unknown> | undefined): CheckHwListOrigin {
  const mode = payload?.listMode === 'archive' ? 'archive' : 'pending';
  return {
    mode,
    page: Number(payload?.listPage ?? 0) || 0,
    filters: (payload?.listFilters as CheckHwListOrigin['filters']) ?? {},
  };
}

export function originToPayload(origin: CheckHwListOrigin): Record<string, unknown> {
  return {
    listMode: origin.mode,
    listPage: origin.page,
    listFilters: origin.filters,
    returnTo: 'hw',
  };
}

export async function sendHomeworkHub(
  admin: SupabaseClient,
  chatId: number,
  telegramId: number,
  courseId: number,
  preface?: string,
): Promise<void> {
  const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
  const screen = renderCheckHomeworkHub(courseId, ctx.title);
  const text = preface ? `${preface}\n\n${screen.text}` : screen.text;
  await sendAdminMessage(chatId, text, screen.keyboard);
}

async function buildQueue(
  admin: SupabaseClient,
  checkTelegramId: number,
  courseId: number,
) {
  const loaded = await loadCheckHomeworkStudents(admin, checkTelegramId, courseId);
  const metaMap = await loadCheckHwMetaMap(admin, loaded.courseSlug, loaded.students);
  const moduleMap = await loadCourseModuleLessonMap(loaded.courseSlug);
  return { ...loaded, metaMap, moduleMap };
}

function collectModeItems(
  students: Awaited<ReturnType<typeof loadCheckHomeworkStudents>>['students'],
  metaMap: Awaited<ReturnType<typeof loadCheckHwMetaMap>>,
  mode: CheckHwListMode,
  filters?: CheckHwListFilters,
): CheckHomeworkListItem[] {
  if (mode === 'archive' && filters?.archiveStatus === 'overdue') {
    const all = attachMetaToQueueItems(collectCheckQueue(students, 'all'), metaMap);
    return all.filter(
      (i) =>
        i.meta?.overdue &&
        i.homework.status !== 'approved' &&
        (i.homework.status === 'waiting' || i.homework.status === 'upcoming'),
    );
  }
  const raw = mode === 'archive' ? collectCheckArchive(students) : collectCheckPending(students);
  return attachMetaToQueueItems(raw, metaMap);
}

async function showList(
  message: AdminMessage,
  courseId: number,
  courseTitle: string,
  items: CheckHomeworkListItem[],
  origin: CheckHwListOrigin,
  moduleMap: Map<number, Set<number>>,
): Promise<void> {
  const filtered = applyCheckHwFilters(items, origin.filters, moduleMap);
  const { pageItems, totalPages } = paginateItems(filtered, origin.page, CHECK_LIST_PAGE_SIZE);
  const screen = renderCheckHomeworkList(courseId, courseTitle, pageItems, origin.mode, {
    page: origin.page,
    totalPages,
    totalCount: filtered.length,
    filters: origin.filters,
  });
  await editScreen(message, screen.text, screen.keyboard);
}

export async function handleCheckHomeworkFamily(
  admin: SupabaseClient,
  message: AdminMessage,
  telegramId: number,
  parts: string[],
): Promise<boolean> {
  const family = parts[1];
  if (family !== 'hw' && family !== 'rej' && family !== 'life') return false;

  const chatId = message.chatId;

  if (family === 'hw') {
    const courseId = parseCourseId(parts[2]);
    if (!courseId) return true;
    const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
    const { students, metaMap, moduleMap } = await buildQueue(admin, telegramId, courseId);

    if (parts[3] === undefined || parts[3] === '') {
      const screen = renderCheckHomeworkHub(courseId, ctx.title);
      await editScreen(message, screen.text, screen.keyboard);
      return true;
    }

    if (parts[3] === 'fl' || parts[3] === 'afl') {
      const mode: CheckHwListMode = parts[3] === 'afl' ? 'archive' : 'pending';
      const page = Number(parts[4] ?? 0) || 0;
      const origin: CheckHwListOrigin = { mode, page, filters: {} };
      const items = collectModeItems(students, metaMap, mode);
      const listToken = mode === 'archive' ? 'arch' : 'pend';
      const filterToken = parts[3];

      if (parts[5] === 's') {
        const uniq = new Map<number, string>();
        for (const item of items) uniq.set(Number(item.studentId), item.studentName);
        const keyboard: InlineKeyboard['inline_keyboard'] = [...uniq.entries()].map(([tg, name]) => [
          { text: name.slice(0, 58), callback_data: `k:hw:${courseId}:${listToken}:${page}:s:${tg}` },
        ]);
        keyboard.push([{ text: '⬅️ Назад', callback_data: `k:hw:${courseId}:${filterToken}:${page}` }]);
        await editScreen(message, '👤 Выберите ученика:', { inline_keyboard: keyboard });
        return true;
      }
      if (parts[5] === 'm') {
        const nums = [...new Set(items.map((i) => i.homework.number))];
        const keyboard: InlineKeyboard['inline_keyboard'] = [];
        for (const [modIndex, lessonNums] of moduleMap.entries()) {
          if (![...lessonNums].some((n) => nums.includes(n))) continue;
          keyboard.push([
            {
              text: `Модуль ${modIndex + 1}`,
              callback_data: `k:hw:${courseId}:${listToken}:${page}:m:${modIndex}`,
            },
          ]);
        }
        keyboard.push([{ text: '⬅️ Назад', callback_data: `k:hw:${courseId}:${filterToken}:${page}` }]);
        await editScreen(message, '📂 Выберите модуль:', { inline_keyboard: keyboard });
        return true;
      }
      if (parts[5] === 'n') {
        const nums = [...new Set(items.map((i) => i.homework.number))].sort((a, b) => a - b);
        const keyboard: InlineKeyboard['inline_keyboard'] = nums.map((n) => [
          { text: `Занятие №${n}`, callback_data: `k:hw:${courseId}:${listToken}:${page}:n:${n}` },
        ]);
        keyboard.push([{ text: '⬅️ Назад', callback_data: `k:hw:${courseId}:${filterToken}:${page}` }]);
        await editScreen(message, '📚 Выберите номер занятия:', { inline_keyboard: keyboard });
        return true;
      }
      if (parts[5] === 'st' && mode === 'archive') {
        const screen = renderCheckArchiveStatusFilters(courseId, page, origin);
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }
      const screen = renderCheckHwFilterMenu(courseId, page, origin);
      await editScreen(message, screen.text, screen.keyboard);
      return true;
    }

    if (parts[3] === 'pend' || parts[3] === 'arch' || parts[3] === 'a' || parts[3] === 'p') {
      const mode: CheckHwListMode =
        parts[3] === 'pend' || parts[3] === 'p' ? 'pending' : 'archive';
      const maybeFilter = parts[4];
      const oldStatus =
        maybeFilter === 'all' ||
        maybeFilter === 'approved' ||
        maybeFilter === 'revision' ||
        maybeFilter === 'overdue' ||
        maybeFilter === 'submitted' ||
        maybeFilter === 'waiting';
      const page = oldStatus ? Number(parts[5] ?? 0) || 0 : Number(parts[4] ?? 0) || 0;
      const filters = parseListFilters(parts, oldStatus ? 6 : 5);
      if (maybeFilter === 'approved' || maybeFilter === 'revision' || maybeFilter === 'overdue') {
        filters.archiveStatus = maybeFilter;
      }
      await showList(
        message,
        courseId,
        ctx.title,
        collectModeItems(students, metaMap, mode, filters),
        { mode, page, filters },
        moduleMap,
      );
      return true;
    }

    if (
      (parts[3] === 'i' ||
        parts[3] === 'v' ||
        parts[3] === 'vr' ||
        parts[3] === 'vd' ||
        parts[3] === 'ok' ||
        parts[3] === 'rej' ||
        parts[3] === 'cmt') &&
      parts[4] &&
      parts[5]
    ) {
      const student = getCuratorStudentRecord(students, parts[4]);
      const hwNum = Number(parts[5]);
      const homework = student ? getCuratorHomeworkRecord(student, hwNum) : undefined;
      const origin = parseOriginFromParts(parts, 6);
      if (!student || !homework) {
        await editScreen(message, 'Работа не найдена.', { inline_keyboard: [] });
        return true;
      }
      const meta = metaMap.get(`${student.id}:${hwNum}`) ?? null;

      if (parts[3] === 'i') {
        let lifeDeducted = false;
        try {
          lifeDeducted = await hasLifeDeductedForLesson(
            admin,
            student.telegramId,
            courseId,
            homework.sanityLessonId,
          );
        } catch {
          lifeDeducted = false;
        }
        const screen = renderCheckHomeworkCard(courseId, ctx.title, student, homework, {
          meta,
          origin,
          lifeDeducted,
        });
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'v') {
        try {
          await sendSubmissionToCurator(admin, telegramId, {
            studentName: student.name,
            lessonNumber: homework.number,
            title: homework.title,
            fileUrl: homework.submissionFileUrl,
            note: homework.submissionNote,
          });
        } catch (error) {
          await sendAdminMessage(
            chatId,
            error instanceof Error ? error.message : 'Не удалось открыть файл работы.',
          );
        }
        if (origin.mode === 'archive') {
          await sendAdminMessage(
            chatId,
            '👀 Файлы работы отправлены выше (если были приложены).',
            {
              inline_keyboard: [
                [
                  {
                    text: '⬅️ К карточке ДЗ',
                    callback_data: encodeHwItemCallback('i', courseId, student.id, hwNum, origin),
                  },
                ],
              ],
            },
          );
        } else {
          const screen = renderCheckVerdict(courseId, student, homework, origin);
          await sendAdminMessage(chatId, screen.text, screen.keyboard);
        }
        return true;
      }

      if (parts[3] === 'vr') {
        const { loadHomeworkReviewNote } = await import('./check-data');
        const { renderCheckArchiveVerdictView } = await import('./check-screens');
        const reviewNote = await loadHomeworkReviewNote(
          admin,
          student.telegramId,
          homework.sanityLessonId,
        );
        const screen = renderCheckArchiveVerdictView(
          courseId,
          student,
          homework,
          origin,
          reviewNote,
        );
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'vd') {
        const screen = renderCheckVerdict(courseId, student, homework, origin);
        await editScreen(message, screen.text, screen.keyboard);
        return true;
      }

      if (parts[3] === 'ok') {
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
          await sendHomeworkHub(
            admin,
            chatId,
            telegramId,
            courseId,
            `✅ ДЗ №${hwNum} одобрено (${student.name}).`,
          );
        } catch (error) {
          const msg = error instanceof CourseHomeworkError ? error.message : 'Не удалось одобрить.';
          await sendAdminMessage(chatId, msg);
        }
        return true;
      }

      if (parts[3] === 'rej') {
        await promptRejectFileStep(admin, telegramId, chatId, {
          courseId,
          studentId: student.id,
          hwNumber: hwNum,
        });
        return true;
      }

      if (parts[3] === 'cmt') {
        try {
          await clearConflictingStaffStates(admin, telegramId, 'curator_reply');
          const promptId = await sendAdminMessage(
            chatId,
            '💬 Комментарий к работе (статус не изменится).\n\nНапишите текст.',
            {
              inline_keyboard: [
                [{ text: '⬅️ Назад', callback_data: encodeHwItemCallback('vd', courseId, student.id, hwNum, origin) }],
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
              studentId: student.id,
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

    return true;
  }

  if (family === 'rej') {
    const courseId = parseCourseId(parts[2]);
    if (!courseId || !parts[4] || !parts[5]) return true;
    const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
    const { students } = await loadCheckHomeworkStudents(admin, telegramId, courseId);
    const student = getCuratorStudentRecord(students, parts[4]);
    const hwNum = Number(parts[5]);
    const origin = parseOriginFromParts(parts, 6);
    if (!student) return true;
    const action = parts[3];

    if (action === 'file' || action === 'c' || action === 't' || action === 'v' || action === 'p') {
      let state = null;
      try {
        state = await getState(admin, telegramId);
      } catch (error) {
        if (!isConversationStateTableError(error)) throw error;
      }
      const prev = (state?.payload ?? {}) as {
        draftFileRef?: string;
        draftFileKind?: 'photo' | 'voice' | 'document';
        draftText?: string;
      };
      await promptRejectFileStep(admin, telegramId, chatId, {
        courseId,
        studentId: student.id,
        hwNumber: hwNum,
        draftFileRef: prev.draftFileRef,
        draftFileKind: prev.draftFileKind,
        draftText: prev.draftText,
      });
      return true;
    }

    if (action === 'fskip' || action === 'note') {
      let state = null;
      try {
        state = await getState(admin, telegramId);
      } catch (error) {
        if (!isConversationStateTableError(error)) throw error;
      }
      const prev = (state?.payload ?? {}) as {
        draftFileRef?: string;
        draftFileKind?: 'photo' | 'voice' | 'document';
        draftText?: string;
      };
      await promptRejectNoteStep(admin, telegramId, chatId, {
        courseId,
        studentId: student.id,
        hwNumber: hwNum,
        draftFileRef: action === 'fskip' ? undefined : prev.draftFileRef,
        draftFileKind: action === 'fskip' ? undefined : prev.draftFileKind,
        draftText: prev.draftText,
      });
      return true;
    }

    if (action === 'nskip' || action === 'skip') {
      let state = null;
      try {
        state = await getState(admin, telegramId);
      } catch (error) {
        if (!isConversationStateTableError(error)) throw error;
      }
      const prev = (state?.payload ?? {}) as {
        draftFileRef?: string;
        draftFileKind?: 'photo' | 'voice' | 'document';
        draftText?: string;
      };
      await showRejectDraftConfirm(
        admin,
        telegramId,
        chatId,
        {
          courseId,
          studentId: student.id,
          hwNumber: hwNum,
          draftText: prev.draftText,
          draftFileRef: prev.draftFileRef,
          draftFileKind: prev.draftFileKind,
        },
        origin,
      );
      return true;
    }

    if (action === 'bare') {
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
          sanityLessonId: lesson.sanityId,
        });
        await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
        await sendHomeworkHub(
          admin,
          chatId,
          telegramId,
          courseId,
          `🔄 ДЗ №${hwNum} отправлено на доработку (${student.name}).`,
        );
      } catch (error) {
        const msg = error instanceof CourseHomeworkError ? error.message : 'Не удалось вернуть на доработку.';
        await sendAdminMessage(chatId, msg);
      }
      return true;
    }

    if (action === 'go') {
      let state = null;
      try {
        state = await getState(admin, telegramId);
      } catch (error) {
        if (!isConversationStateTableError(error)) throw error;
      }
      const payload = (state?.payload ?? {}) as {
        draftText?: string;
        draftFileRef?: string;
        draftFileKind?: 'photo' | 'voice' | 'document';
        draftVoiceRef?: string;
      };
      const rawNote = payload.draftText?.trim() || '';
      const note = isPlaceholderReviewText(rawNote) ? undefined : rawNote;
      const files: Array<{ kind: 'photo' | 'document' | 'voice'; ref: string }> = [];
      if (payload.draftFileRef && payload.draftFileKind && payload.draftFileKind !== 'voice') {
        files.push({ kind: payload.draftFileKind, ref: payload.draftFileRef });
      } else if (payload.draftFileRef && payload.draftFileKind === 'voice' && !payload.draftVoiceRef) {
        files.push({ kind: 'voice', ref: payload.draftFileRef });
      }
      if (payload.draftVoiceRef) {
        files.push({ kind: 'voice', ref: payload.draftVoiceRef });
      }
      const storedNote = packHomeworkReviewNote(note, files);
      try {
        const { lesson } = await rejectCourseHomeworkByCurator(
          admin,
          telegramId,
          student.telegramId,
          hwNum,
          storedNote,
          { courseId, courseSlug: ctx.slug },
        );
        await notifyStudentHomeworkReviewed(admin, student.telegramId, {
          lessonNumber: lesson.lessonNumber,
          title: lesson.title,
          approved: false,
          sanityLessonId: lesson.sanityId,
        });
        await resetStaffDialogKeepWorkspace(admin, telegramId, chatId);
        await sendHomeworkHub(
          admin,
          chatId,
          telegramId,
          courseId,
          `🔄 ДЗ №${hwNum} отправлено на доработку (${student.name}).`,
        );
      } catch (error) {
        const msg = error instanceof CourseHomeworkError ? error.message : 'Не удалось вернуть на доработку.';
        await sendAdminMessage(chatId, msg);
      }
      return true;
    }

    return true;
  }

  const courseId = parseCourseId(parts[2]);
  if (!courseId) return true;
  const ctx = await assertCheckCourseAccess(admin, telegramId, courseId);
  const { students } = await loadCheckHomeworkStudents(admin, telegramId, courseId);

  if (parts[3] === 'ask' && parts[4] && parts[5]) {
    const student = getCuratorStudentRecord(students, parts[4]);
    const hwNum = Number(parts[5]);
    const homework = student ? getCuratorHomeworkRecord(student, hwNum) : undefined;
    const origin = parseOriginFromParts(parts, 6);
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
      origin,
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
      if (lifeDeduction?.deducted) {
        const { notifyStudentLifeDeducted } = await import('@/lib/bot/student-push-notify');
        void notifyStudentLifeDeducted(admin, student.telegramId, {
          courseTitle: ctx.title,
          livesLeft: lifeDeduction.livesCurrent,
          livesMax: lifeDeduction.livesMax,
        });
      }
      await sendHomeworkHub(
        admin,
        chatId,
        telegramId,
        courseId,
        `${note}${formatLifeDeductionNote(lifeDeduction)}`,
      );
    } catch (error) {
      const msg = error instanceof CourseHomeworkError ? error.message : 'Не удалось снять жизнь.';
      await sendAdminMessage(chatId, msg);
    }
    return true;
  }

  return true;
}

export async function promptRejectFileStep(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  payload: {
    courseId: number;
    studentId: string;
    hwNumber: number;
    draftFileRef?: string;
    draftFileKind?: 'photo' | 'voice' | 'document';
    draftText?: string;
  },
): Promise<void> {
  const origin = originFromPayload(payload as Record<string, unknown>);
  const prompt = renderCheckRejectFilePrompt(payload.courseId, payload.studentId, payload.hwNumber, origin);
  try {
    await clearConflictingStaffStates(admin, telegramId, 'curator_reply');
    const promptId = await sendAdminMessage(chatId, prompt.text, prompt.keyboard);
    await saveState(
      admin,
      telegramId,
      { chatId, messageId: promptId ?? 0 },
      CHECK_REJECT_FILE_STEP as never,
      (await checkDialogPayload(admin, telegramId, {
        ...payload,
        ...originToPayload(origin),
      })) as never,
    );
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    await sendAdminMessage(chatId, migrationText('bot_conversation_states.sql'));
  }
}

export async function promptRejectNoteStep(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  payload: {
    courseId: number;
    studentId: string;
    hwNumber: number;
    draftFileRef?: string;
    draftFileKind?: 'photo' | 'voice' | 'document';
    draftText?: string;
  },
): Promise<void> {
  const origin = originFromPayload(payload as Record<string, unknown>);
  const prompt = renderCheckRejectNotePrompt(payload.courseId, payload.studentId, payload.hwNumber, origin);
  try {
    await clearConflictingStaffStates(admin, telegramId, 'curator_reply');
    const promptId = await sendAdminMessage(chatId, prompt.text, prompt.keyboard);
    await saveState(
      admin,
      telegramId,
      { chatId, messageId: promptId ?? 0 },
      CHECK_REJECT_COMMENT_STEP as never,
      (await checkDialogPayload(admin, telegramId, {
        ...payload,
        ...originToPayload(origin),
      })) as never,
    );
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    await sendAdminMessage(chatId, migrationText('bot_conversation_states.sql'));
  }
}

export async function showRejectDraftConfirm(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  payload: {
    courseId: number;
    studentId: string;
    hwNumber: number;
    draftText?: string | null;
    draftFileKind?: 'photo' | 'voice' | 'document' | null;
    draftFileRef?: string | null;
    draftVoiceRef?: string | null;
  },
  origin: CheckHwListOrigin,
): Promise<void> {
  const { sendTelegramFileById } = await import('@/lib/bot/studentHomeworkFlow');
  if (payload.draftFileRef && payload.draftFileKind && payload.draftFileKind !== 'voice') {
    await sendTelegramFileById(
      chatId,
      payload.draftFileRef.replace(/^tg:/, ''),
      payload.draftFileKind,
    );
  } else if (payload.draftFileRef && payload.draftFileKind === 'voice' && !payload.draftVoiceRef) {
    await sendTelegramFileById(chatId, payload.draftFileRef.replace(/^tg:/, ''), 'voice');
  }
  if (payload.draftVoiceRef) {
    await sendTelegramFileById(chatId, payload.draftVoiceRef.replace(/^tg:/, ''), 'voice');
  }

  const screen = renderCheckRejectDraftConfirm(
    payload.courseId,
    payload.studentId,
    payload.hwNumber,
    origin,
    {
      text: payload.draftText,
      fileKind: payload.draftFileKind,
      voiceAttached: Boolean(payload.draftVoiceRef),
    },
  );
  const promptId = await sendAdminMessage(chatId, screen.text, screen.keyboard);
  await saveState(
    admin,
    telegramId,
    { chatId, messageId: promptId ?? 0 },
    CHECK_REJECT_CONFIRM_STEP as never,
    (await checkDialogPayload(admin, telegramId, {
      ...payload,
      draftVoiceRef: payload.draftVoiceRef,
      ...originToPayload(origin),
    })) as never,
  );
}
