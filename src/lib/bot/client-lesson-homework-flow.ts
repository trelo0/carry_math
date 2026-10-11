import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { formatLessonDateTimeRu } from '@/lib/teacher/format';
import {
  canStudentSubmitHomework,
  getLessonHomeworkForStudent,
  homeworkReviewStatusLabel,
  resolveHomeworkAssignmentUrl,
  submitLessonHomework,
  type LessonHomeworkReviewStatus,
  type LessonHomeworkSubmissionFile,
} from '@/lib/lesson-homework';
import {
  getState,
  isConversationStateTableError,
  sendAdminMessage,
  type AdminPayload,
} from './admin/core';
import {
  clientHomeButton,
  deliverClientHubScreen,
  resetClientDialogToHub,
  saveClientDialogState,
  type ClientHubDeliverOptions,
} from './client-nav';
import { formatTelegramFileRef } from './studentHomeworkFlow';
import { resolveClientState } from './client-state';
import { buildClientReplyKeyboard } from './client-menu';

export const CLIENT_LESSON_HW_SUBMIT_STEP = 'client:lesson-hw-submit' as const;

type HwSubmitPayload = AdminPayload & {
  hwLessonId?: number;
  hwDraftText?: string;
  hwDraftFiles?: LessonHomeworkSubmissionFile[];
};

export function isClientLessonHomeworkCallback(data: string): boolean {
  return data.startsWith('cl:hw:');
}

type StudentHwListItem = {
  lessonId: number;
  topic: string;
  startsAt: string;
  reviewStatus: LessonHomeworkReviewStatus;
  teacherComment: string | null;
  submittedAt: string | null;
};

async function listStudentLessonHomeworks(
  admin: SupabaseClient,
  telegramId: number,
): Promise<StudentHwListItem[]> {
  const { data: lessons, error: lessonError } = await admin
    .from('scheduled_lessons')
    .select('id, topic, starts_at')
    .eq('telegram_id', telegramId)
    .neq('status', 'cancelled')
    .order('starts_at', { ascending: false })
    .limit(80);
  if (lessonError) throw lessonError;
  const ids = (lessons ?? []).map((l) => l.id as number);
  if (ids.length === 0) return [];

  const { data: hwRows, error: hwError } = await admin
    .from('homework_assignments')
    .select('lesson_id, review_status, teacher_comment, submitted_at')
    .in('lesson_id', ids);
  if (hwError) throw hwError;

  const hwMap = new Map(
    (hwRows ?? []).map((r) => [
      r.lesson_id as number,
      {
        reviewStatus: r.review_status as LessonHomeworkReviewStatus,
        teacherComment: (r.teacher_comment as string | null) ?? null,
        submittedAt: (r.submitted_at as string | null) ?? null,
      },
    ]),
  );

  return (lessons ?? [])
    .filter((l) => hwMap.has(l.id as number))
    .map((l) => {
      const hw = hwMap.get(l.id as number)!;
      return {
        lessonId: l.id as number,
        topic: l.topic as string,
        startsAt: l.starts_at as string,
        reviewStatus: hw.reviewStatus,
        teacherComment: hw.teacherComment,
        submittedAt: hw.submittedAt,
      };
    });
}

export async function showClientLessonHomeworkHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const state = await resolveClientState(admin, telegramId);
  if (!state.hasActiveLessonProduct && !state.hasLessonHistory) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'Раздел ДЗ занятий доступен при активных занятиях.',
      reply_markup: buildClientReplyKeyboard(state),
    });
    return;
  }

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'lesson-hw-hub',
    [
      '📝 Домашние задания занятий',
      '',
      'История отправленных работ и отправка нового решения.',
    ].join('\n'),
    {
      inline_keyboard: [
        [{ text: '📋 История отправленных ДЗ', callback_data: 'cl:hw:hist' }],
        [{ text: '📤 Отправить ДЗ', callback_data: 'cl:hw:pick' }],
        [clientHomeButton()],
      ],
    },
    deliver,
  );
}

export async function showClientLessonHomeworkHistory(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const items = (await listStudentLessonHomeworks(admin, telegramId)).filter(
    (i) => i.submittedAt || i.reviewStatus === 'done' || i.reviewStatus === 'revision' || i.reviewStatus === 'submitted',
  );

  if (items.length === 0) {
    await deliverClientHubScreen(
      admin,
      telegramId,
      chatId,
      'lesson-hw-hist-empty',
      '📋 История ДЗ\n\nПока нет отправленных работ.',
      {
        inline_keyboard: [
          [{ text: '◀️ К ДЗ', callback_data: 'cl:hw:hub' }],
          [clientHomeButton()],
        ],
      },
      deliver,
    );
    return;
  }

  const lines = ['📋 История ДЗ занятий', ''];
  const rows: Array<Array<Record<string, string>>> = [];
  for (const item of items.slice(0, 12)) {
    lines.push(`• ${item.topic}`);
    lines.push(`  ${formatLessonDateTimeRu(item.startsAt)}`);
    lines.push(`  Статус: ${homeworkReviewStatusLabel(item.reviewStatus)}`);
    if (item.reviewStatus === 'revision' && item.teacherComment?.trim()) {
      lines.push(`  Комментарий: ${item.teacherComment.trim()}`);
    }
    lines.push('');
    rows.push([
      {
        text: `${homeworkReviewStatusLabel(item.reviewStatus)} · ${item.topic}`.slice(0, 60),
        callback_data: `cl:hw:open:${item.lessonId}`,
      },
    ]);
  }
  rows.push([{ text: '◀️ К ДЗ', callback_data: 'cl:hw:hub' }], [clientHomeButton()]);

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'lesson-hw-hist',
    lines.join('\n').trim().slice(0, 3500),
    { inline_keyboard: rows },
    deliver,
  );
}

export async function showClientLessonHomeworkSubmitPicker(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const items = (await listStudentLessonHomeworks(admin, telegramId)).filter((i) =>
    canStudentSubmitHomework(i.reviewStatus),
  );

  if (items.length === 0) {
    await deliverClientHubScreen(
      admin,
      telegramId,
      chatId,
      'lesson-hw-pick-empty',
      '📤 Отправить ДЗ\n\nСейчас нет заданий, которые можно сдать.\n(Ожидаются статусы «Не сдано» или «Нужна доработка».)',
      {
        inline_keyboard: [
          [{ text: '◀️ К ДЗ', callback_data: 'cl:hw:hub' }],
          [clientHomeButton()],
        ],
      },
      deliver,
    );
    return;
  }

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'lesson-hw-pick',
    '📤 Отправить ДЗ\n\nВыберите занятие:',
    {
      inline_keyboard: [
        ...items.slice(0, 15).map((item) => [
          {
            text: `${item.topic}`.slice(0, 60),
            callback_data: `cl:hw:submit:${item.lessonId}`,
          },
        ]),
        [{ text: '◀️ К ДЗ', callback_data: 'cl:hw:hub' }],
        [clientHomeButton()],
      ],
    },
    deliver,
  );
}

export async function showClientLessonHomeworkCard(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  lessonId: number,
): Promise<void> {
  const homework = await getLessonHomeworkForStudent(admin, telegramId, lessonId);
  if (!homework) {
    await sendAdminMessage(chatId, 'Домашнее задание для этого занятия не найдено.');
    return;
  }

  const { data: lesson } = await admin
    .from('scheduled_lessons')
    .select('topic, starts_at')
    .eq('id', lessonId)
    .eq('telegram_id', telegramId)
    .maybeSingle();

  const lines = [
    '📝 Домашнее задание',
    '',
    lesson ? `Занятие: ${lesson.topic as string}` : '',
    lesson ? `Дата: ${formatLessonDateTimeRu(lesson.starts_at as string)}` : '',
    '',
    homework.instructionText?.trim() || 'Условие в прикреплённом файле.',
    homework.dueAt ? `\nСрок: ${formatLessonDateTimeRu(homework.dueAt)}` : '',
    '',
    `Статус: ${homeworkReviewStatusLabel(homework.reviewStatus)}`,
  ];
  if (homework.teacherComment?.trim()) {
    lines.push('', `Комментарий преподавателя: ${homework.teacherComment.trim()}`);
  }

  const keyboard: Array<Array<Record<string, string>>> = [];
  if (canStudentSubmitHomework(homework.reviewStatus)) {
    keyboard.push([{ text: 'Отправить решение', callback_data: `cl:hw:submit:${lessonId}` }]);
  }
  if (homework.submittedAt) {
    keyboard.push([{ text: 'Посмотреть моё решение', callback_data: `cl:hw:mine:${lessonId}` }]);
  }
  keyboard.push(
    [{ text: '◀️ К занятию', callback_data: `cl:less:v:${lessonId}:menu` }],
    [{ text: '🏠 Главное меню', callback_data: 'cl:home' }],
  );

  await sendAdminMessage(chatId, lines.filter(Boolean).join('\n'), { inline_keyboard: keyboard });

  const assignmentUrl = await resolveHomeworkAssignmentUrl(admin, homework.storagePath);
  if (assignmentUrl) {
    await sendAdminMessage(chatId, `📎 Файл задания: ${homework.fileName}\n${assignmentUrl}`);
  }
}

export async function beginClientLessonHomeworkSubmit(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  lessonId: number,
): Promise<void> {
  const homework = await getLessonHomeworkForStudent(admin, telegramId, lessonId);
  if (!homework || !canStudentSubmitHomework(homework.reviewStatus)) {
    await sendAdminMessage(chatId, 'Сейчас нельзя отправить решение для этого задания.');
    return;
  }

  const payload: HwSubmitPayload = {
    hwLessonId: lessonId,
    hwDraftText: '',
    hwDraftFiles: [],
  };
  try {
    await saveClientDialogState(admin, telegramId, chatId, CLIENT_LESSON_HW_SUBMIT_STEP, payload);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  await sendAdminMessage(
    chatId,
    '📤 Отправка домашней работы\n\n' +
      'Пришлите фото, документ или текст. Можно несколько файлов подряд.\n' +
      'Когда всё готово — нажмите «Отправить на проверку».\n\n' +
      'Отмена — «Отмена».',
    {
      inline_keyboard: [
        [{ text: '✅ Отправить на проверку', callback_data: `cl:hw:confirm:${lessonId}` }],
        [{ text: '❌ Отменить', callback_data: `cl:hw:cancel:${lessonId}` }],
      ],
    },
  );
}

async function loadSubmitPayload(admin: SupabaseClient, telegramId: number): Promise<HwSubmitPayload | null> {
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return null;
  }
  if (!state || state.step !== CLIENT_LESSON_HW_SUBMIT_STEP) return null;
  return state.payload as HwSubmitPayload;
}

async function saveSubmitPayload(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  payload: HwSubmitPayload,
): Promise<void> {
  await saveClientDialogState(admin, telegramId, chatId, CLIENT_LESSON_HW_SUBMIT_STEP, payload);
}

export async function handleClientLessonHomeworkMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  const payload = await loadSubmitPayload(admin, telegramId);
  if (!payload?.hwLessonId) return false;

  const trimmed = text.trim();
  if (/^отмена$/i.test(trimmed)) {
    await resetClientDialogToHub(admin, telegramId);
    await sendAdminMessage(chatId, 'Отправка отменена.');
    return true;
  }

  if (!trimmed) return true;

  const next: HwSubmitPayload = {
    ...payload,
    hwDraftText: [payload.hwDraftText?.trim(), trimmed].filter(Boolean).join('\n\n'),
  };
  await saveSubmitPayload(admin, telegramId, chatId, next);
  await sendAdminMessage(chatId, 'Текст добавлен. Можно отправить ещё файлы или нажать «Отправить на проверку».');
  return true;
}

export async function handleClientLessonHomeworkAttachment(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  attachment: { fileId: string; kind: 'document' | 'photo'; fileName?: string },
): Promise<boolean> {
  const payload = await loadSubmitPayload(admin, telegramId);
  if (!payload?.hwLessonId) return false;

  const file: LessonHomeworkSubmissionFile = {
    ref: formatTelegramFileRef(attachment.fileId),
    kind: attachment.kind,
    name: attachment.fileName,
  };
  const files = [...(payload.hwDraftFiles ?? []), file];
  await saveSubmitPayload(admin, telegramId, chatId, { ...payload, hwDraftFiles: files });
  await sendAdminMessage(chatId, `Файл добавлен (${files.length}). Нажмите «Отправить на проверку», когда закончите.`);
  return true;
}

async function confirmSubmit(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  lessonId: number,
): Promise<void> {
  const payload = await loadSubmitPayload(admin, telegramId);
  if (!payload || payload.hwLessonId !== lessonId) {
    await sendAdminMessage(chatId, 'Сессия отправки устарела. Откройте задание заново.');
    return;
  }

  const existing = await getLessonHomeworkForStudent(admin, telegramId, lessonId);
  if (existing?.submittedAt && !canStudentSubmitHomework(existing.reviewStatus)) {
    await resetClientDialogToHub(admin, telegramId);
    await sendAdminMessage(chatId, 'Решение уже отправлено. Статус — в карточке занятия.');
    return;
  }

  try {
    await submitLessonHomework(admin, telegramId, lessonId, {
      submissionText: payload.hwDraftText,
      submissionFiles: payload.hwDraftFiles ?? [],
    });
    await resetClientDialogToHub(admin, telegramId);
    await sendAdminMessage(
      chatId,
      '✅ Решение отправлено на проверку.\n\nСтатус можно посмотреть в карточке занятия.',
    );
  } catch (error) {
    await sendAdminMessage(
      chatId,
      error instanceof Error ? error.message : 'Не удалось отправить работу.',
    );
  }
}

async function showMySubmission(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  lessonId: number,
): Promise<void> {
  const homework = await getLessonHomeworkForStudent(admin, telegramId, lessonId);
  if (!homework?.submittedAt) {
    await sendAdminMessage(chatId, 'Решение ещё не отправлялось.');
    return;
  }

  const lines = [
    '📤 Ваше решение',
    '',
    `Статус: ${homeworkReviewStatusLabel(homework.reviewStatus)}`,
    homework.submissionText?.trim() ? `\n${homework.submissionText.trim()}` : '',
  ];
  await sendAdminMessage(chatId, lines.filter(Boolean).join('\n'));

  for (const file of homework.submissionFiles) {
    await sendAdminMessage(chatId, `📎 ${file.name ?? file.kind}\n${file.ref}`);
  }
}

export async function handleClientLessonHomeworkCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!isClientLessonHomeworkCallback(data)) return false;

  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }

  const editAt = { chatId, messageId };

  if (data === 'cl:hw:hub') {
    await showClientLessonHomeworkHub(admin, telegramId, chatId, { editAt });
    return true;
  }
  if (data === 'cl:hw:hist') {
    await showClientLessonHomeworkHistory(admin, telegramId, chatId, { editAt });
    return true;
  }
  if (data === 'cl:hw:pick') {
    await showClientLessonHomeworkSubmitPicker(admin, telegramId, chatId, { editAt });
    return true;
  }

  if (data.startsWith('cl:hw:open:')) {
    const lessonId = Number(data.slice('cl:hw:open:'.length));
    if (Number.isFinite(lessonId)) {
      await showClientLessonHomeworkCard(admin, telegramId, chatId, lessonId);
    }
    return true;
  }

  if (data.startsWith('cl:hw:submit:')) {
    const lessonId = Number(data.slice('cl:hw:submit:'.length));
    if (Number.isFinite(lessonId)) {
      await beginClientLessonHomeworkSubmit(admin, telegramId, chatId, lessonId);
    }
    return true;
  }

  if (data.startsWith('cl:hw:confirm:')) {
    const lessonId = Number(data.slice('cl:hw:confirm:'.length));
    if (Number.isFinite(lessonId)) {
      await confirmSubmit(admin, telegramId, chatId, lessonId);
    }
    return true;
  }

  if (data.startsWith('cl:hw:cancel:')) {
    await resetClientDialogToHub(admin, telegramId);
    await sendAdminMessage(chatId, 'Отправка отменена.');
    return true;
  }

  if (data.startsWith('cl:hw:mine:')) {
    const lessonId = Number(data.slice('cl:hw:mine:'.length));
    if (Number.isFinite(lessonId)) {
      await showMySubmission(admin, telegramId, chatId, lessonId);
    }
    return true;
  }

  return false;
}
