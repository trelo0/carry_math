import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  clearStateIfAvailable,
  getState,
  isConversationStateTableError,
  saveState,
  sendAdminMessage,
  type AdminPayload,
} from '@/lib/bot/admin/core';
import {
  CourseHomeworkError,
  markHomeworkSubmitted,
  resolveSubmitTargetLesson,
} from '@/lib/bot/education/course-homework';
import { notifyCuratorHomeworkSubmitted } from '@/lib/curator/homework-events';
import { formatRemainingMs } from './client-format';
import { getUserContext } from './accesses';

export const COURSE_HW_FILE_STEP = 'student:course-hw-submit' as const;
export const COURSE_HW_COMMENT_STEP = 'student:course-hw-comment' as const;
export const COURSE_HW_CONFIRM_STEP = 'student:course-hw-confirm' as const;

type SubmitPayload = AdminPayload & {
  sanityLessonId?: string;
  draftFileUrl?: string;
  draftFileKind?: 'photo' | 'document';
  draftNote?: string;
  lessonTitle?: string;
  lessonNumber?: number;
  courseSlug?: string;
  courseTitle?: string;
  hwWizardMessageId?: number;
};

function formatSubmitError(error: unknown): string {
  if (error instanceof CourseHomeworkError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'Не удалось отправить домашку.';
}

export function formatTelegramFileRef(fileId: string): string {
  return `tg:${fileId}`;
}

function cancelKeyboard() {
  return {
    inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'chw:cancel' }]],
  };
}

function commentStepKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '⏭ Пропустить комментарий', callback_data: 'chw:skip' }],
      [
        { text: '◀️ Назад', callback_data: 'chw:back' },
        { text: '❌ Отмена', callback_data: 'chw:cancel' },
      ],
    ],
  };
}

function confirmStepKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✅ Отправить на проверку', callback_data: 'chw:confirm' }],
      [
        { text: '◀️ Назад', callback_data: 'chw:back' },
        { text: '❌ Отмена', callback_data: 'chw:cancel' },
      ],
    ],
  };
}

function fileStepText(payload: SubmitPayload): string {
  return [
    '📝 Сдача домашнего задания',
    '',
    payload.courseTitle ? `Курс: ${payload.courseTitle}` : null,
    payload.lessonNumber != null
      ? `Занятие №${payload.lessonNumber}: ${payload.lessonTitle ?? ''}`
      : null,
    '',
    'Отправьте файл с решением (фото или документ) или текст задания одним сообщением.',
  ]
    .filter(Boolean)
    .join('\n');
}

function commentStepText(): string {
  return '📎 Файл получен.\n\nНапишите комментарий к ДЗ (необязательно) или нажмите «Пропустить комментарий».';
}

function confirmStepText(payload: SubmitPayload): string {
  const note = payload.draftNote?.trim();
  return [
    '✅ Подтверждение отправки',
    '',
    payload.lessonNumber != null
      ? `Вебинар №${payload.lessonNumber}: ${payload.lessonTitle ?? ''}`
      : null,
    payload.draftFileUrl ? '📎 Файл приложен' : '📎 Файла нет',
    note ? `💬 Комментарий ученика:\n${note}` : '💬 Комментарий: —',
    '',
    'Отправить работу куратору?',
  ]
    .filter(Boolean)
    .join('\n');
}

async function saveHwWizardState(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  step: typeof COURSE_HW_FILE_STEP | typeof COURSE_HW_COMMENT_STEP | typeof COURSE_HW_CONFIRM_STEP,
  payload: SubmitPayload,
): Promise<void> {
  try {
    await saveState(
      admin,
      telegramId,
      { chatId, messageId: payload.hwWizardMessageId ?? 0 },
      step,
      payload,
    );
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
}

async function renderHwWizard(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  step: typeof COURSE_HW_FILE_STEP | typeof COURSE_HW_COMMENT_STEP | typeof COURSE_HW_CONFIRM_STEP,
  payload: SubmitPayload,
): Promise<SubmitPayload> {
  const text =
    step === COURSE_HW_FILE_STEP
      ? fileStepText(payload)
      : step === COURSE_HW_COMMENT_STEP
        ? commentStepText()
        : confirmStepText(payload);
  const keyboard =
    step === COURSE_HW_FILE_STEP
      ? cancelKeyboard()
      : step === COURSE_HW_COMMENT_STEP
        ? commentStepKeyboard()
        : confirmStepKeyboard();

  const messageId = payload.hwWizardMessageId;
  if (messageId) {
    const edited = await telegramSend('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: keyboard,
    });
    if (edited.ok) {
      await saveHwWizardState(admin, telegramId, chatId, step, payload);
      return payload;
    }
  }

  const newId = await sendAdminMessage(chatId, text, keyboard);
  const next = { ...payload, hwWizardMessageId: newId ?? payload.hwWizardMessageId };
  await saveHwWizardState(admin, telegramId, chatId, step, next);
  return next;
}

async function assertCanSubmitCourseHw(
  admin: SupabaseClient,
  telegramId: number,
  preferredSanityLessonId?: string,
): Promise<{ ok: true; target: NonNullable<Awaited<ReturnType<typeof resolveSubmitTargetLesson>>> } | { ok: false; message: string }> {
  const ctx = await getUserContext(admin, telegramId);
  const hasCourse = Boolean(ctx?.accesses.course);
  const target = await resolveSubmitTargetLesson(admin, telegramId, preferredSanityLessonId);
  if (!target) {
    return {
      ok: false,
      message:
        'Сначала откройте вебинар в личном кабинете на сайте.\n\nПосле просмотра появится таймер сдачи и можно будет отправить ДЗ.',
    };
  }
  const paidForCourse = target.hasCourseProduct ?? hasCourse;
  if (target.lesson.isTrialFree && !paidForCourse) {
    return {
      ok: false,
      message:
        'Пробное занятие доступно для просмотра всем.\n\nСдать ДЗ по нему можно после покупки курса.',
    };
  }
  return { ok: true, target };
}

export async function beginCourseHomeworkSubmit(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  preferredSanityLessonId?: string,
): Promise<boolean> {
  const gate = await assertCanSubmitCourseHw(admin, telegramId, preferredSanityLessonId);
  if (!gate.ok) {
    if (preferredSanityLessonId) {
      const { showClientCourseHomeworkLessonStatus } = await import(
        './client-course-homework-hub'
      );
      const opened = await showClientCourseHomeworkLessonStatus(
        admin,
        telegramId,
        chatId,
        preferredSanityLessonId,
        { forcePush: true },
        { requireSubmitted: true },
      );
      if (opened) return true;
    }
    await sendAdminMessage(chatId, gate.message);
    return true;
  }

  const { lesson, progress } = gate.target;
  const remaining =
    typeof progress?.homework_remaining_ms === 'number'
      ? progress.homework_remaining_ms
      : progress?.homework_deadline_at
        ? Math.max(0, Date.parse(progress.homework_deadline_at) - Date.now())
        : null;

  const intro = [
    fileStepText({
      lessonTitle: lesson.title,
      lessonNumber: lesson.lessonNumber,
      courseTitle: gate.target.courseTitle,
    }),
    remaining != null ? `\n⏱ Осталось на сдачу: ${formatRemainingMs(remaining)}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const payload: SubmitPayload = {
    sanityLessonId: lesson.sanityId,
    lessonTitle: lesson.title,
    lessonNumber: lesson.lessonNumber,
    courseSlug: gate.target.courseSlug,
    courseTitle: gate.target.courseTitle,
  };
  const newId = await sendAdminMessage(chatId, intro, cancelKeyboard());
  await saveHwWizardState(admin, telegramId, chatId, COURSE_HW_FILE_STEP, {
    ...payload,
    hwWizardMessageId: newId ?? undefined,
  });
  return true;
}

async function finishSubmit(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  sanityLessonId: string,
  input: {
    note?: string;
    fileUrl?: string;
    fileKind?: 'photo' | 'document';
    courseSlug?: string;
  },
): Promise<void> {
  await markHomeworkSubmitted(admin, telegramId, sanityLessonId, input, {
    courseSlug: input.courseSlug ?? null,
  });
  try {
    await notifyCuratorHomeworkSubmitted(admin, telegramId, sanityLessonId, input);
  } catch (error) {
    console.error('[course-hw] curator notify failed:', error);
  }
  let wizardId: number | undefined;
  try {
    const state = await getState(admin, telegramId);
    wizardId = (state?.payload as SubmitPayload | undefined)?.hwWizardMessageId;
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
  await clearStateIfAvailable(admin, telegramId);
  const { showClientCourseHomeworkLessonStatus } = await import('./client-course-homework-hub');
  if (wizardId) {
    await showClientCourseHomeworkLessonStatus(admin, telegramId, chatId, sanityLessonId, {
      editAt: { chatId, messageId: wizardId },
    });
    return;
  }
  await showClientCourseHomeworkLessonStatus(admin, telegramId, chatId, sanityLessonId, {
    forcePush: true,
  });
}

async function loadHwState(admin: SupabaseClient, telegramId: number) {
  try {
    return await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return null;
  }
}

export async function handleStudentHomeworkMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  const { isClientReplyLabel } = await import('./client-menu');
  if (isClientReplyLabel(text)) return false;

  const state = await loadHwState(admin, telegramId);
  if (!state) return false;

  const step = state.step as string;
  const payload = state.payload as SubmitPayload;
  const sanityLessonId = payload.sanityLessonId;
  if (!sanityLessonId) return false;

  if (
    step !== COURSE_HW_FILE_STEP &&
    step !== COURSE_HW_COMMENT_STEP &&
    step !== COURSE_HW_CONFIRM_STEP
  ) {
    return false;
  }

  if (text.trim().toLowerCase() === 'отмена') {
    await clearStateIfAvailable(admin, telegramId);
    await sendAdminMessage(chatId, 'Сдача домашки отменена.');
    return true;
  }

  if (step === COURSE_HW_FILE_STEP) {
    const nextPayload = { ...payload, draftNote: text.trim() };
    await renderHwWizard(admin, telegramId, chatId, COURSE_HW_COMMENT_STEP, nextPayload);
    return true;
  }

  if (step === COURSE_HW_COMMENT_STEP) {
    const note = text.trim();
    const nextPayload = { ...payload, draftNote: note || payload.draftNote };
    await renderHwWizard(admin, telegramId, chatId, COURSE_HW_CONFIRM_STEP, nextPayload);
    return true;
  }

  if (step === COURSE_HW_CONFIRM_STEP) {
    if (/^(отправить|да|confirm)$/i.test(text.trim())) {
      try {
        await finishSubmit(admin, telegramId, chatId, sanityLessonId, {
          note: payload.draftNote,
          fileUrl: payload.draftFileUrl,
          fileKind: payload.draftFileKind,
          courseSlug: payload.courseSlug,
        });
      } catch (error) {
        await sendAdminMessage(chatId, formatSubmitError(error));
      }
      return true;
    }
    await sendAdminMessage(chatId, 'Нажмите «Отправить на проверку» или «Отмена».');
    return true;
  }

  return false;
}

export async function handleStudentHomeworkAttachment(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  attachment: { fileId: string; kind: 'document' | 'photo'; fileName?: string },
): Promise<boolean> {
  const state = await loadHwState(admin, telegramId);
  if (!state) return false;

  const step = state.step as string;
  if (step !== COURSE_HW_FILE_STEP && step !== COURSE_HW_COMMENT_STEP) return false;

  const payload = state.payload as SubmitPayload;
  const sanityLessonId = payload.sanityLessonId;
  if (!sanityLessonId) return false;

  const fileUrl = formatTelegramFileRef(attachment.fileId);
  await renderHwWizard(admin, telegramId, chatId, COURSE_HW_COMMENT_STEP, {
    ...payload,
    draftFileUrl: fileUrl,
    draftFileKind: attachment.kind,
  });
  return true;
}

export async function handleCourseHomeworkCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!data.startsWith('chw:')) return false;
  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }

  if (data === 'chw:cancel') {
    const cancelPayload = (await loadHwState(admin, telegramId))?.payload as SubmitPayload | undefined;
    const slug = cancelPayload?.courseSlug;
    await clearStateIfAvailable(admin, telegramId);
    const { showClientCourseHomeworkHub } = await import('./client-course-homework-hub');
    await showClientCourseHomeworkHub(admin, telegramId, chatId, { forcePush: true }, slug);
    return true;
  }

  const state = await loadHwState(admin, telegramId);
  if (!state) {
    await sendAdminMessage(chatId, 'Сессия сдачи устарела. Откройте «Сдать ДЗ» снова.');
    return true;
  }
  const payload = state.payload as SubmitPayload;
  const sanityLessonId = payload.sanityLessonId;
  if (!sanityLessonId) return true;

  if (data === 'chw:back') {
    const step = state.step as string;
    if (step === COURSE_HW_CONFIRM_STEP) {
      await renderHwWizard(admin, telegramId, chatId, COURSE_HW_COMMENT_STEP, payload);
      return true;
    }
    if (step === COURSE_HW_COMMENT_STEP) {
      await renderHwWizard(admin, telegramId, chatId, COURSE_HW_FILE_STEP, {
        ...payload,
        draftNote: undefined,
        draftFileUrl: undefined,
        draftFileKind: undefined,
      });
      return true;
    }
    await renderHwWizard(admin, telegramId, chatId, COURSE_HW_FILE_STEP, payload);
    return true;
  }

  if (data === 'chw:skip') {
    await renderHwWizard(admin, telegramId, chatId, COURSE_HW_CONFIRM_STEP, payload);
    return true;
  }

  if (data === 'chw:confirm') {
    if (!payload.draftFileUrl && !payload.draftNote?.trim()) {
      await sendAdminMessage(chatId, 'Сначала отправьте файл или текст задания.');
      return true;
    }
    try {
      await finishSubmit(admin, telegramId, chatId, sanityLessonId, {
        note: payload.draftNote,
        fileUrl: payload.draftFileUrl,
        fileKind: payload.draftFileKind,
        courseSlug: payload.courseSlug,
      });
    } catch (error) {
      await sendAdminMessage(chatId, formatSubmitError(error));
    }
    return true;
  }

  return false;
}

export async function notifyStudentHomeworkReviewed(
  admin: SupabaseClient,
  studentTelegramId: number,
  params: {
    lessonNumber: number;
    title: string;
    approved: boolean;
    note?: string;
    /** tg:fileId или http(s) — файл с правками от куратора */
    reviewFileRef?: string | null;
    reviewFileKind?: 'photo' | 'document' | 'voice' | null;
    sanityLessonId?: string;
  },
): Promise<void> {
  const { studentNotifyKeyboard } = await import('./student-push-notify');

  const { data } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', studentTelegramId)
    .maybeSingle();
  const chatId = data?.chat_id as number | undefined;
  if (!chatId) return;

  const text = params.approved
    ? `✅ ДЗ №${params.lessonNumber} «${params.title}» одобрено.`
    : `🔄 Куратор отправил ДЗ №${params.lessonNumber} «${params.title}» на доработку.\n\nНажмите «Посмотреть пояснение».`;

  const replyMarkup =
    !params.approved && params.sanityLessonId
      ? studentNotifyKeyboard([
          [
            {
              text: 'Посмотреть пояснение',
              callback_data: `cl:chw:rev:${params.sanityLessonId}`,
            },
          ],
        ])
      : studentNotifyKeyboard();

  await telegramSend('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
  });
}

export async function sendTelegramFileById(
  chatId: number,
  fileId: string,
  preferred?: 'photo' | 'document' | 'voice' | null,
): Promise<{ ok: boolean; description?: string }> {
  if (preferred === 'voice') {
    return telegramSend('sendVoice', { chat_id: chatId, voice: fileId });
  }
  const attempts =
    preferred === 'document'
      ? (['sendDocument', 'sendPhoto'] as const)
      : (['sendPhoto', 'sendDocument'] as const);
  let last: { ok: boolean; description?: string } = { ok: false, description: 'Не удалось отправить файл.' };
  for (const method of attempts) {
    last = await telegramSend(method, {
      chat_id: chatId,
      ...(method === 'sendPhoto' ? { photo: fileId } : { document: fileId }),
    });
    if (last.ok) return last;
  }
  return last;
}

export async function sendSubmissionToCurator(
  admin: SupabaseClient,
  curatorTelegramId: number,
  submission: {
    fileUrl: string | null;
    fileKind?: 'photo' | 'document' | null;
    note: string | null;
    lessonNumber: number;
    title: string;
    studentName: string;
  },
): Promise<void> {
  const { data } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', curatorTelegramId)
    .maybeSingle();
  const chatId = data?.chat_id as number | undefined;
  if (!chatId) return;

  const header =
    `📎 Работа ученика ${submission.studentName}\n` +
    `Занятие №${submission.lessonNumber}: ${submission.title}`;
  const note = submission.note?.trim();
  const text = note
    ? `${header}\n\n💬 Комментарий ученика:\n${note}`
    : header;
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text,
  });

  const fileUrl = submission.fileUrl?.trim() ?? '';
  if (fileUrl.startsWith('tg:')) {
    const result = await sendTelegramFileById(chatId, fileUrl.slice(3), submission.fileKind);
    if (!result.ok) {
      throw new Error(result.description ?? 'Не удалось переслать файл. Попросите ученика сдать работу ещё раз.');
    }
  } else if (fileUrl.startsWith('http')) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: `🔗 Файл: ${fileUrl}`,
    });
  } else if (!note) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'Ученик не приложил файл и не оставил комментарий.',
    });
  }
}
