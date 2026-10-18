import type { SupabaseClient } from '@supabase/supabase-js';
import {
  flattenCourseLessons,
  getDistrictCourseContent,
} from '@/lib/studio/courseContent';
import {
  listSubmitTargetLessons,
  resolveSubmitTargetLesson,
  type SubmitTargetLesson,
} from '@/lib/bot/education/course-homework';
import { deadlineUiState } from '@/lib/bot/education/homework-deadline';
import type { CourseLessonStudentProgress } from '@/lib/bot/education/course-progress';
import { listStudentPurchasedVisibleCourseContexts } from '@/lib/bot/education/student-course-context';
import { beginCourseHomeworkSubmit } from './studentHomeworkFlow';
import {
  clientBackButton,
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
  courseTitle: string | undefined,
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

  const head = [
    courseTitle ? `📚 ${courseTitle}` : null,
    `Сейчас: ДЗ №${lessonNumber} «${lessonTitle}»`,
  ]
    .filter(Boolean)
    .join('\n');

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

function parseCourseHomeworkHubSlug(data: string): string | undefined {
  if (data === 'cl:chw:hub') return undefined;
  if (data.startsWith('cl:chw:hub:')) return data.slice('cl:chw:hub:'.length) || undefined;
  return undefined;
}

function parseCourseHomeworkHistSlug(data: string): string | undefined {
  if (data === 'cl:chw:hist') return undefined;
  if (data.startsWith('cl:chw:hist:')) return data.slice('cl:chw:hist:'.length) || undefined;
  return undefined;
}

function filterTargetsBySlug(targets: SubmitTargetLesson[], courseSlug?: string): SubmitTargetLesson[] {
  if (!courseSlug) return targets;
  return targets.filter((t) => t.courseSlug === courseSlug);
}

export async function showClientCourseHomeworkHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
  courseSlug?: string,
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

  const allTargets = await listSubmitTargetLessons(admin, telegramId);
  const targets = filterTargetsBySlug(allTargets, courseSlug);

  let courseTitle: string | undefined;
  if (courseSlug) {
    const content = await getDistrictCourseContent(courseSlug).catch(() => null);
    courseTitle = content?.title?.trim();
  }

  const lines = ['📝 Домашние задания', courseTitle ? `📚 ${courseTitle}` : null, ''].filter(
    (x): x is string => x != null,
  );

  if (targets.length === 0) {
    lines.push('Сейчас ДЗ не ждём.\nКогда откроется сдача после вебинара — статус появится здесь.');
  } else {
    for (const t of targets) {
      lines.push(
        currentHwBlock(
          courseSlug ? courseTitle : t.courseTitle,
          t.lesson.title,
          t.lesson.lessonNumber,
          t.progress,
        ),
      );
      lines.push('');
    }
  }

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  if (targets.length === 1) {
    keyboard.push([
      {
        text: '📤 Отправить ДЗ',
        callback_data: courseSlug ? `cl:chw:submit:${courseSlug}` : 'cl:chw:submit',
      },
    ]);
  } else if (targets.length > 1) {
    for (const t of targets) {
      const slug = t.courseSlug ?? courseSlug ?? '_default';
      const label = t.courseTitle ? `📤 Сдать · ${t.courseTitle}` : '📤 Отправить ДЗ';
      keyboard.push([
        {
          text: label.length > 64 ? '📤 Сдать ДЗ' : label,
          callback_data: `cl:chw:go:${slug === '_default' ? (t.courseSlug ?? slug) : slug}`,
        },
      ]);
    }
  }

  const histCb = courseSlug ? `cl:chw:hist:${courseSlug}` : 'cl:chw:hist';
  keyboard.push([{ text: '📋 История сдач', callback_data: histCb }], [clientBackButton()]);

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    courseSlug ? `course-hw-hub:${courseSlug}` : 'course-hw-hub',
    lines.join('\n').trim(),
    { inline_keyboard: keyboard },
    deliver,
  );
}

export async function showClientCourseHomeworkHistory(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
  courseSlug?: string,
): Promise<void> {
  const enrollments = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
  const contexts = courseSlug
    ? enrollments.filter((c) => c.slug === courseSlug)
    : enrollments;

  if (contexts.length === 0 && courseSlug) {
    const content = await getDistrictCourseContent(courseSlug).catch(() => null);
    if (content) {
      contexts.push({ slug: courseSlug, courseId: 0, title: content.title });
    }
  }

  const lessonMap = new Map<
    string,
    { lessonNumber: number; title: string; courseTitle: string }
  >();

  for (const ctx of contexts) {
    const content = await getDistrictCourseContent(ctx.slug).catch(() => null);
    if (!content) continue;
    const courseTitle = ctx.title?.trim() || content.title;
    for (const lesson of flattenCourseLessons(content)) {
      if (lesson.publicationStatus !== 'published') continue;
      lessonMap.set(lesson.sanityId, {
        lessonNumber: lesson.lessonNumber,
        title: lesson.title,
        courseTitle,
      });
    }
  }

  const sanityIds = [...lessonMap.keys()];
  if (sanityIds.length === 0) {
    await deliverClientHubScreen(
      admin,
      telegramId,
      chatId,
      'course-hw-hist-empty',
      '📋 История ДЗ курса\n\nПока нет отправленных работ.',
      {
        inline_keyboard: [
          [
            {
              text: '◀️ К ДЗ',
              callback_data: courseSlug ? `cl:chw:hub:${courseSlug}` : 'cl:chw:hub',
            },
          ],
          [clientBackButton()],
        ],
      },
      deliver,
    );
    return;
  }

  const { data: rows, error } = await admin
    .from('course_lesson_student_progress')
    .select(
      'sanity_lesson_id, homework_status, homework_submitted_at, homework_completed_at, review_note, submission_note, homework_deadline_at',
    )
    .eq('telegram_id', telegramId)
    .in('sanity_lesson_id', sanityIds)
    .not('homework_status', 'eq', 'pending')
    .order('homework_submitted_at', { ascending: false });
  if (error) throw error;

  const items = (rows ?? []).filter((r) => r.sanity_lesson_id && lessonMap.has(r.sanity_lesson_id as string));
  const hubCb = courseSlug ? `cl:chw:hub:${courseSlug}` : 'cl:chw:hub';

  if (items.length === 0) {
    await deliverClientHubScreen(
      admin,
      telegramId,
      chatId,
      'course-hw-hist-empty',
      '📋 История ДЗ курса\n\nПока нет отправленных работ.',
      {
        inline_keyboard: [[{ text: '◀️ К ДЗ', callback_data: hubCb }], [clientBackButton()]],
      },
      deliver,
    );
    return;
  }

  const lines = ['📋 История ДЗ', ''];
  for (const row of items.slice(0, 15)) {
    const lesson = lessonMap.get(row.sanity_lesson_id as string)!;
    if (!courseSlug) lines.push(`📚 ${lesson.courseTitle}`);
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
    courseSlug ? `course-hw-hist:${courseSlug}` : 'course-hw-hist',
    lines.join('\n').trim().slice(0, 3900),
    {
      inline_keyboard: [[{ text: '◀️ К ДЗ', callback_data: hubCb }], [clientBackButton()]],
    },
    deliver,
  );
}

export async function beginClientCourseHomeworkFromHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  courseSlug?: string,
): Promise<void> {
  const target = await resolveSubmitTargetLesson(admin, telegramId, undefined, courseSlug);
  if (!target) {
    await deliverClientHubScreen(
      admin,
      telegramId,
      chatId,
      'course-hw-submit-empty',
      '📤 Отправить ДЗ\n\nСейчас ДЗ не ждём — нет занятия, по которому ожидается сдача.',
      {
        inline_keyboard: [
          [
            {
              text: '◀️ К ДЗ',
              callback_data: courseSlug ? `cl:chw:hub:${courseSlug}` : 'cl:chw:hub',
            },
          ],
          [clientBackButton()],
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
  const intro = [
    target.courseTitle ? `Курс: ${target.courseTitle}` : null,
    `Вебинар №${target.lesson.lessonNumber}: ${target.lesson.title}`,
    remaining != null ? `Осталось на сдачу: ${formatRemainingMs(remaining)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  await telegramSend('sendMessage', { chat_id: chatId, text: intro });
  await beginCourseHomeworkSubmit(admin, telegramId, chatId, target.lesson.sanityId);
}

export function isClientCourseHomeworkCallback(data: string): boolean {
  return data.startsWith('cl:chw:');
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

  if (data === 'cl:chw:hub' || data.startsWith('cl:chw:hub:')) {
    const slug = parseCourseHomeworkHubSlug(data);
    await showClientCourseHomeworkHub(admin, telegramId, chatId, { editAt }, slug);
    return true;
  }
  if (data === 'cl:chw:hist' || data.startsWith('cl:chw:hist:')) {
    const slug = parseCourseHomeworkHistSlug(data);
    await showClientCourseHomeworkHistory(admin, telegramId, chatId, { editAt }, slug);
    return true;
  }
  if (data === 'cl:chw:submit' || data.startsWith('cl:chw:submit:')) {
    const slug = data.startsWith('cl:chw:submit:') ? data.slice('cl:chw:submit:'.length) : undefined;
    await beginClientCourseHomeworkFromHub(admin, telegramId, chatId, slug || undefined);
    return true;
  }
  if (data.startsWith('cl:chw:go:')) {
    const slug = data.slice('cl:chw:go:'.length);
    await beginClientCourseHomeworkFromHub(admin, telegramId, chatId, slug || undefined);
    return true;
  }
  return false;
}
