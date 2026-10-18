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

  const text = [
    '📝 Сдача домашнего задания',
    '',
    gate.target.courseTitle ? `Курс: ${gate.target.courseTitle}` : null,
    `Занятие №${lesson.lessonNumber}: ${lesson.title}`,
    remaining != null ? `⏱ Осталось на сдачу: ${formatRemainingMs(remaining)}` : null,
    '',
    '1️⃣ Отправьте файл с решением (фото или документ).',
    '2️⃣ При необходимости добавьте комментарий.',
    '3️⃣ Нажмите «Отправить на проверку».',
    '',
    'Можно отменить в любой момент.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    await saveState(admin, telegramId, { chatId, messageId: 0 }, COURSE_HW_FILE_STEP, {
      sanityLessonId: lesson.sanityId,
      lessonTitle: lesson.title,
      lessonNumber: lesson.lessonNumber,
      courseSlug: gate.target.courseSlug,
      courseTitle: gate.target.courseTitle,
    });
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  await sendAdminMessage(chatId, text, cancelKeyboard());
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
  await clearStateIfAvailable(admin, telegramId);
  await sendAdminMessage(
    chatId,
    '✅ Домашка отправлена.\n\nСтатус: Ожидает проверки.',
  );
  const { showClientCourseHomeworkLessonStatus } = await import('./client-course-homework-hub');
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
    // Текст на первом шаге — как файл-замена (заметка без вложения).
    await saveState(admin, telegramId, { chatId, messageId: 0 }, COURSE_HW_COMMENT_STEP, {
      ...payload,
      draftNote: text.trim(),
    });
    await sendAdminMessage(
      chatId,
      'Текст сохранён.\n\nМожете приложить файл или сразу написать комментарий / нажать «Пропустить комментарий».',
      {
        inline_keyboard: [
          [{ text: '⏭ Пропустить комментарий', callback_data: 'chw:skip' }],
          [{ text: '◀️ Назад', callback_data: 'chw:back' }, { text: '❌ Отмена', callback_data: 'chw:cancel' }],
        ],
      },
    );
    return true;
  }

  if (step === COURSE_HW_COMMENT_STEP) {
    const note = text.trim();
    await saveState(admin, telegramId, { chatId, messageId: 0 }, COURSE_HW_CONFIRM_STEP, {
      ...payload,
      draftNote: note || payload.draftNote,
    });
    await sendConfirmPrompt(chatId, {
      ...payload,
      draftNote: note || payload.draftNote,
    });
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

async function sendConfirmPrompt(chatId: number, payload: SubmitPayload): Promise<void> {
  const lines = [
    '✅ Подтверждение отправки',
    '',
    payload.lessonNumber != null
      ? `Вебинар №${payload.lessonNumber}: ${payload.lessonTitle ?? ''}`
      : null,
    payload.draftFileUrl ? '📎 Файл приложен' : '📎 Файла нет',
    payload.draftNote?.trim() ? `💬 Комментарий: ${payload.draftNote.trim()}` : '💬 Комментарий: —',
    '',
    'Отправить работу куратору?',
  ].filter(Boolean);

  await sendAdminMessage(chatId, lines.join('\n'), {
    inline_keyboard: [
      [{ text: '✅ Отправить на проверку', callback_data: 'chw:confirm' }],
      [{ text: '◀️ Назад', callback_data: 'chw:back' }, { text: '❌ Отмена', callback_data: 'chw:cancel' }],
    ],
  });
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
  await saveState(admin, telegramId, { chatId, messageId: 0 }, COURSE_HW_COMMENT_STEP, {
    ...payload,
    draftFileUrl: fileUrl,
    draftFileKind: attachment.kind,
  });

  await sendAdminMessage(
    chatId,
    '📎 Файл получен.\n\nНапишите комментарий к ДЗ (необязательно) или нажмите «Пропустить комментарий».',
    {
      inline_keyboard: [
        [{ text: '⏭ Пропустить комментарий', callback_data: 'chw:skip' }],
        [{ text: '◀️ Назад', callback_data: 'chw:back' }, { text: '❌ Отмена', callback_data: 'chw:cancel' }],
      ],
    },
  );
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
    await clearStateIfAvailable(admin, telegramId);
    await sendAdminMessage(chatId, 'Сдача домашки отменена.');
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
    await saveState(admin, telegramId, { chatId, messageId: 0 }, COURSE_HW_FILE_STEP, {
      ...payload,
      draftNote: undefined,
      draftFileUrl: undefined,
    });
    await sendAdminMessage(
      chatId,
      'Отправьте файл с решением (фото или документ) или текст задания одним сообщением.',
      cancelKeyboard(),
    );
    return true;
  }

  if (data === 'chw:skip') {
    await saveState(admin, telegramId, { chatId, messageId: 0 }, COURSE_HW_CONFIRM_STEP, payload);
    await sendConfirmPrompt(chatId, payload);
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
  },
): Promise<void> {
  const { data } = await admin
    .from('bot_members')
    .select('chat_id')
    .eq('telegram_id', studentTelegramId)
    .maybeSingle();
  const chatId = data?.chat_id as number | undefined;
  if (!chatId) return;

  const base = params.approved
    ? `✅ Домашка по занятию №${params.lessonNumber} «${params.title}» одобрена.`
    : `❌ Домашка по занятию №${params.lessonNumber} «${params.title}» отправлена на доработку.`;
  const text = params.note?.trim() ? `${base}\n\nКомментарий:\n${params.note.trim()}` : base;
  await telegramSend('sendMessage', { chat_id: chatId, text });

  const ref = params.reviewFileRef?.trim();
  if (!ref) return;
  if (ref.startsWith('tg:')) {
    const fileId = ref.slice(3);
    const kind = params.reviewFileKind ?? 'document';
    if (kind === 'voice') {
      await telegramSend('sendVoice', { chat_id: chatId, voice: fileId });
    } else if (kind === 'photo') {
      await telegramSend('sendPhoto', { chat_id: chatId, photo: fileId });
    } else {
      await telegramSend('sendDocument', { chat_id: chatId, document: fileId });
    }
  } else if (ref.startsWith('http')) {
    await telegramSend('sendMessage', { chat_id: chatId, text: `🔗 Файл с правками: ${ref}` });
  }
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

  if (submission.note?.trim()) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text:
        `📎 Работа ученика ${submission.studentName}\n` +
        `Занятие №${submission.lessonNumber}: ${submission.title}\n\n` +
        submission.note.trim(),
    });
  }

  if (submission.fileUrl?.startsWith('tg:')) {
    const fileId = submission.fileUrl.slice(3);
    const asPhoto = submission.fileKind === 'photo';
    const result = await telegramSend(asPhoto ? 'sendPhoto' : 'sendDocument', {
      chat_id: chatId,
      ...(asPhoto ? { photo: fileId } : { document: fileId }),
    });
    if (!result.ok) {
      throw new Error(result.description ?? 'Не удалось переслать файл куратору.');
    }
  } else if (submission.fileUrl?.startsWith('http')) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: `🔗 Файл: ${submission.fileUrl}`,
    });
  }
}
