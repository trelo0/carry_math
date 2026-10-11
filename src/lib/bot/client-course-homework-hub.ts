import type { SupabaseClient } from '@supabase/supabase-js';
import {
  flattenCourseLessons,
  getDistrictCourseContent,
} from '@/lib/studio/courseContent';
import { resolveSubmitTargetLesson } from '@/lib/bot/education/course-homework';
import { deadlineUiState } from '@/lib/bot/education/homework-deadline';
import type { CourseLessonStudentProgress } from '@/lib/bot/education/course-progress';
import { beginCourseHomeworkSubmit } from './studentHomeworkFlow';
import {
  clientHomeButton,
  deliverClientHubScreen,
  type ClientHubDeliverOptions,
} from './client-nav';
import { formatDateTimeShort, formatRemainingMs } from './client-format';
import { resolveClientState } from './client-state';
import { telegramSend } from '@/lib/telegram';
import { buildClientReplyKeyboard } from './client-menu';

function hwStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'ожидает сдачи';
    case 'submitted':
      return 'на проверке';
    case 'approved':
      return 'одобрено';
    case 'rejected':
      return 'на доработке';
    default:
      return status;
  }
}

function currentHwBlock(
  lessonTitle: string,
  lessonNumber: number,
  progress: CourseLessonStudentProgress | null,
): string {
  const phase = deadlineUiState(progress);
  const remaining =
    typeof progress?.homework_remaining_ms === 'number'
      ? progress.homework_remaining_ms
      : progress?.homework_deadline_at
        ? Math.max(0, Date.parse(progress.homework_deadline_at) - Date.now())
        : null;

  const head = `Сейчас: ДЗ №${lessonNumber} «${lessonTitle}»`;
  switch (phase) {
    case 'waiting_review':
      return [
        head,
        'Статус: отправлено, ожидает проверки',
        progress?.homework_submitted_at
          ? `Отправлено: ${formatDateTimeShort(progress.homework_submitted_at)}`
          : null,
      ]
        .filter(Boolean)
        .join('\n');
    case 'revision':
      return [
        head,
        'Статус: нужна доработка',
        remaining != null ? `Осталось времени: ${formatRemainingMs(remaining)}` : null,
        progress?.review_note?.trim() ? `Комментарий: ${progress.review_note.trim()}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    case 'approved':
      return [head, 'Статус: одобрено — можно переходить дальше'].join('\n');
    case 'overdue':
      return [head, 'Статус: срок сдачи истёк', 'Сдайте работу как можно скорее'].join('\n');
    case 'soon':
    case 'ok':
      return [
        head,
        'Статус: нужно сдать ДЗ',
        remaining != null ? `Осталось времени: ${formatRemainingMs(remaining)}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    default:
      return [head, 'Статус: ожидается сдача'].join('\n');
  }
}

export async function showClientCourseHomeworkHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const state = await resolveClientState(admin, telegramId);
  if (!state.hasActiveCourse) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'Раздел ДЗ курса доступен после подключения курса.',
      reply_markup: buildClientReplyKeyboard(state),
    });
    return;
  }

  const target = await resolveSubmitTargetLesson(admin, telegramId);
  const currentBlock = target
    ? currentHwBlock(target.lesson.title, target.lesson.lessonNumber, target.progress)
    : 'Сейчас ДЗ не ждём.\nКогда откроется сдача после вебинара — статус появится здесь.';

  const text = ['📝 Домашние задания курса', '', currentBlock].join('\n');
  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'course-hw-hub',
    text,
    {
      inline_keyboard: [
        [{ text: '📤 Отправить ДЗ', callback_data: 'cl:chw:submit' }],
        [{ text: '📋 История сдач', callback_data: 'cl:chw:hist' }],
        [{ text: '◀️ К курсу', callback_data: 'cl:course:mine' }],
        [clientHomeButton()],
      ],
    },
    deliver,
  );
}

export async function showClientCourseHomeworkHistory(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const content = await getDistrictCourseContent().catch(() => null);
  const lessons = content
    ? flattenCourseLessons(content)
        .filter((l) => l.publicationStatus === 'published')
        .sort((a, b) => a.lessonNumber - b.lessonNumber)
    : [];
  const lessonMap = new Map(lessons.map((l) => [l.sanityId, l]));

  const { data: rows, error } = await admin
    .from('course_lesson_student_progress')
    .select(
      'sanity_lesson_id, homework_status, homework_submitted_at, homework_completed_at, review_note, submission_note, homework_deadline_at',
    )
    .eq('telegram_id', telegramId)
    .not('homework_status', 'eq', 'pending')
    .order('homework_submitted_at', { ascending: false });
  if (error) throw error;

  const items = (rows ?? []).filter((r) => r.sanity_lesson_id && lessonMap.has(r.sanity_lesson_id as string));
  if (items.length === 0) {
    await deliverClientHubScreen(
      admin,
      telegramId,
      chatId,
      'course-hw-hist-empty',
      '📋 История ДЗ курса\n\nПока нет отправленных работ.',
      {
        inline_keyboard: [
          [{ text: '◀️ К ДЗ', callback_data: 'cl:chw:hub' }],
          [clientHomeButton()],
        ],
      },
      deliver,
    );
    return;
  }

  const lines = ['📋 История ДЗ курса', ''];
  for (const row of items.slice(0, 15)) {
    const lesson = lessonMap.get(row.sanity_lesson_id as string)!;
    lines.push(`№${lesson.lessonNumber} · ${lesson.title}`);
    lines.push(`Статус: ${hwStatusLabel(row.homework_status as string)}`);
    if (row.homework_submitted_at) {
      lines.push(`Отправлено: ${formatDateTimeShort(row.homework_submitted_at as string)}`);
    }
    if (row.homework_completed_at) {
      lines.push(`Проверено: ${formatDateTimeShort(row.homework_completed_at as string)}`);
    }
    if (row.homework_status === 'rejected' && (row.review_note as string | null)?.trim()) {
      lines.push(`Почему на доработке: ${(row.review_note as string).trim()}`);
    }
    if (row.homework_status === 'approved') {
      lines.push('Результат: одобрено');
    }
    lines.push('');
  }

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'course-hw-hist',
    lines.join('\n').trim().slice(0, 3900),
    {
      inline_keyboard: [
        [{ text: '◀️ К ДЗ', callback_data: 'cl:chw:hub' }],
        [clientHomeButton()],
      ],
    },
    deliver,
  );
}

export async function beginClientCourseHomeworkFromHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
): Promise<void> {
  const target = await resolveSubmitTargetLesson(admin, telegramId);
  if (!target) {
    await deliverClientHubScreen(
      admin,
      telegramId,
      chatId,
      'course-hw-submit-empty',
      '📤 Отправить ДЗ\n\nСейчас ДЗ не ждём — нет занятия, по которому ожидается сдача.',
      {
        inline_keyboard: [
          [{ text: '◀️ К ДЗ', callback_data: 'cl:chw:hub' }],
          [clientHomeButton()],
        ],
      },
      { forcePush: true },
    );
    return;
  }

  const remaining =
    typeof target.progress?.homework_remaining_ms === 'number'
      ? target.progress.homework_remaining_ms
      : target.progress?.homework_deadline_at
        ? Math.max(0, Date.parse(target.progress.homework_deadline_at) - Date.now())
        : null;
  const intro =
    `Вебинар №${target.lesson.lessonNumber}: ${target.lesson.title}` +
    (remaining != null ? `\nОсталось на сдачу: ${formatRemainingMs(remaining)}` : '');
  await telegramSend('sendMessage', { chat_id: chatId, text: intro });
  await beginCourseHomeworkSubmit(admin, telegramId, chatId, target.lesson.sanityId);
}

export function isClientCourseHomeworkCallback(data: string): boolean {
  return data.startsWith('cl:chw:') || data === 'cl:course:mine';
}

export async function handleClientCourseHomeworkCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!isClientCourseHomeworkCallback(data)) return false;
  if (callbackQueryId) {
    await telegramSend('answerCallbackQuery', { callback_query_id: callbackQueryId });
  }

  const editAt = { chatId, messageId };

  if (data === 'cl:course:mine') {
    const { showClientMyCourseHub } = await import('./client-course-hub');
    await showClientMyCourseHub(admin, telegramId, chatId, { editAt });
    return true;
  }
  if (data === 'cl:chw:hub') {
    await showClientCourseHomeworkHub(admin, telegramId, chatId, { editAt });
    return true;
  }
  if (data === 'cl:chw:hist') {
    await showClientCourseHomeworkHistory(admin, telegramId, chatId, { editAt });
    return true;
  }
  if (data === 'cl:chw:submit') {
    await beginClientCourseHomeworkFromHub(admin, telegramId, chatId);
    return true;
  }
  return false;
}
