import type { SupabaseClient } from '@supabase/supabase-js';
import {
  flattenCourseLessons,
  getDistrictCourseContent,
} from '@/lib/studio/courseContent';
import {
  listSubmitTargetLessons,
  listSubmittedAwaitingReviewForCourse,
  resolveSubmitTargetLesson,
  type SubmitTargetLesson,
} from '@/lib/bot/education/course-homework';
import { deadlineUiState } from '@/lib/bot/education/homework-deadline';
import type { CourseLessonStudentProgress } from '@/lib/bot/education/course-progress';
import { listStudentPurchasedVisibleCourseContexts } from '@/lib/bot/education/student-course-context';
import { beginCourseHomeworkSubmit, sendTelegramFileById } from './studentHomeworkFlow';
import {
  isPlaceholderReviewText,
  unpackHomeworkReviewParts,
} from '@/lib/bot/education/homework-review-note';
import { beginStudentMentorQuestion } from './studentMentorFlow';
import {
  clientBackButton,
  deliverClientHubScreen,
  loadClientHubPayload,
  navStackForCourseHomeworkHub,
  type ClientHubDeliverOptions,
} from './client-nav';
import { formatDateTimeShort, formatRemainingMs } from './client-format';
import { resolveClientState } from './client-state';
import { telegramSend } from '@/lib/telegram';
import { buildClientReplyKeyboard } from './client-menu';

async function activeCourseSlugFromHub(
  admin: SupabaseClient,
  telegramId: number,
): Promise<string | undefined> {
  const loaded = await loadClientHubPayload(admin, telegramId);
  const slug = loaded?.payload.activeCourseSlug?.trim();
  return slug || undefined;
}

function hwStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'ожидает сдачи';
    case 'submitted':
      return 'ожидает проверки';
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
        progress?.homework_submitted_at || progress?.updated_at
          ? `Отправлено: ${formatDateTimeShort(
              (progress.homework_submitted_at ?? progress.updated_at) as string,
            )}`
          : null,
      ]
        .filter(Boolean)
        .join('\n');
    case 'revision':
      return [
        head,
        '✏️ Статус: на доработке',
        remaining != null ? `⏱ Осталось: ${formatRemainingMs(remaining)}` : null,
        'Откройте «Посмотреть пояснение» для просмотра комментария проверяющего.',
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

/** Корень раздела ДЗ: выбор курса и/или занятий с преподавателем. */
export async function showClientHomeworkMenu(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const state = await resolveClientState(admin, telegramId);
  const courses = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
  const hasLessons = state.hasActiveLessonProduct;

  if (courses.length === 1 && !hasLessons) {
    await showClientCourseHomeworkHub(admin, telegramId, chatId, deliver, courses[0]!.slug);
    return;
  }

  const lines = ['📝 Домашние задания', '', 'Выберите раздел:'];
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const c of courses) {
    keyboard.push([
      { text: `🎓 ${c.title.slice(0, 52)}`, callback_data: `cl:chw:hub:${c.slug}` },
    ]);
  }
  if (hasLessons) {
    keyboard.push([
      { text: '👨‍🏫 ДЗ по занятиям с преподавателем', callback_data: 'cl:chw:lesson' },
    ]);
  }
  keyboard.push([clientBackButton()]);

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'course-hw-root',
    lines.join('\n'),
    { inline_keyboard: keyboard },
    deliver,
  );
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

  const purchased = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
  if (!courseSlug && purchased.length > 1) {
    await showClientHomeworkMenu(admin, telegramId, chatId, deliver);
    return;
  }

  const allTargets = await listSubmitTargetLessons(admin, telegramId);
  let targets = filterTargetsBySlug(allTargets, courseSlug ?? purchased[0]?.slug);
  const slugForAwaiting = courseSlug ?? purchased[0]?.slug;
  if (slugForAwaiting) {
    const awaiting = await listSubmittedAwaitingReviewForCourse(admin, telegramId, slugForAwaiting);
    const seen = new Set(targets.map((t) => t.lesson.sanityId));
    for (const row of awaiting) {
      if (!seen.has(row.lesson.sanityId)) {
        targets.push(row);
        seen.add(row.lesson.sanityId);
      }
    }
  }

  let courseTitle: string | undefined;
  if (courseSlug) {
    const content = await getDistrictCourseContent(courseSlug).catch(() => null);
    courseTitle = content?.title?.trim();
  }

  const lines = ['📝 Домашние задания', courseTitle ? `📚 ${courseTitle}` : null, ''].filter(
    (x): x is string => x != null,
  );

  if (targets.length === 0) {
    lines.push(
      'Сейчас ДЗ не ждём.\nСначала откройте вебинар в личном кабинете на сайте — после просмотра появится сдача и таймер.',
    );
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
    const t = targets[0]!;
    const phase = deadlineUiState(t.progress);
    if (phase === 'waiting_review') {
      keyboard.push([
        {
          text: '👁 Посмотреть ДЗ',
          callback_data: `cl:chw:view:${t.lesson.sanityId}`,
        },
      ]);
    } else if (phase === 'revision') {
      keyboard.push([
        {
          text: '📄 Посмотреть пояснение',
          callback_data: `cl:chw:rev:${t.lesson.sanityId}`,
        },
      ]);
    } else {
      keyboard.push([
        {
          text: '📤 Отправить ДЗ',
          callback_data: courseSlug ? `cl:chw:submit:${courseSlug}` : 'cl:chw:submit',
        },
      ]);
    }
  } else if (targets.length > 1) {
    for (const t of targets) {
      const slug = t.courseSlug ?? courseSlug ?? '_default';
      const phase = deadlineUiState(t.progress);
      if (phase === 'waiting_review') {
        keyboard.push([
          {
            text: `👁 Ожидает проверки · №${t.lesson.lessonNumber}`.slice(0, 64),
            callback_data: `cl:chw:view:${t.lesson.sanityId}`,
          },
        ]);
      } else if (phase === 'revision') {
        keyboard.push([
          {
            text: `📄 Пояснение · №${t.lesson.lessonNumber}`.slice(0, 64),
            callback_data: `cl:chw:rev:${t.lesson.sanityId}`,
          },
        ]);
      } else {
        const label = t.courseTitle ? `📤 Сдать · ${t.courseTitle}` : '📤 Отправить ДЗ';
        keyboard.push([
          {
            text: label.length > 64 ? '📤 Сдать ДЗ' : label,
            callback_data: `cl:chw:go:${slug === '_default' ? (t.courseSlug ?? slug) : slug}`,
          },
        ]);
      }
    }
  }

  const histCb = courseSlug ? `cl:chw:hist:${courseSlug}` : 'cl:chw:hist';
  keyboard.push([{ text: '📋 Архив ДЗ', callback_data: histCb }], [clientBackButton()]);

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    courseSlug ? `course-hw-hub:${courseSlug}` : 'course-hw-hub',
    lines.join('\n').trim(),
    { inline_keyboard: keyboard },
    {
      ...deliver,
      hubPayloadExtra: courseSlug ? { activeCourseSlug: courseSlug } : undefined,
    },
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
      '📋 Архив ДЗ\n\nПока нет отправленных работ.',
      {
        inline_keyboard: [
          [
            {
              text: '◀️ К ДЗ',
              callback_data: courseSlug ? `cl:chw:hub:${courseSlug}` : 'cl:chw:hub',
            },
          ],
        ],
      },
      deliver,
    );
    return;
  }

  const { data: rows, error } = await admin
    .from('course_lesson_student_progress')
    .select(
      'sanity_lesson_id, homework_status, updated_at, homework_completed_at, review_note, submission_note, homework_deadline_at',
    )
    .eq('telegram_id', telegramId)
    .in('sanity_lesson_id', sanityIds)
    .not('homework_status', 'eq', 'pending')
    .order('updated_at', { ascending: false });
  if (error) throw error;

  const items = (rows ?? []).filter((r) => r.sanity_lesson_id && lessonMap.has(r.sanity_lesson_id as string));
  const hubCb = courseSlug ? `cl:chw:hub:${courseSlug}` : 'cl:chw:hub';

  if (items.length === 0) {
    await deliverClientHubScreen(
      admin,
      telegramId,
      chatId,
      'course-hw-hist-empty',
      '📋 Архив ДЗ\n\nПока нет отправленных работ.',
      {
        inline_keyboard: [[{ text: '◀️ К ДЗ', callback_data: hubCb }]],
      },
      deliver,
    );
    return;
  }

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const row of items.slice(0, 15)) {
    const lesson = lessonMap.get(row.sanity_lesson_id as string)!;
    const status = hwStatusLabel(row.homework_status as string);
    const sent =
      row.updated_at && row.homework_status !== 'pending'
        ? formatDateTimeShort(row.updated_at as string)
        : '';
    const checked = row.homework_completed_at
      ? formatDateTimeShort(row.homework_completed_at as string)
      : '';
    const meta = [status, sent ? `отпр. ${sent}` : '', checked ? `пр. ${checked}` : '']
      .filter(Boolean)
      .join(' · ');
    keyboard.push([
      {
        text: `№${lesson.lessonNumber} · ${lesson.title.slice(0, 28)} (${meta})`.slice(0, 64),
        callback_data: `cl:chw:view:${row.sanity_lesson_id as string}:a`,
      },
    ]);
  }
  keyboard.push([{ text: '◀️ К ДЗ', callback_data: hubCb }]);

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    courseSlug ? `course-hw-hist:${courseSlug}` : 'course-hw-hist',
    ['📋 Архив ДЗ', '', 'Выберите работу — откроется история проверок.'].join('\n'),
    { inline_keyboard: keyboard },
    deliver,
  );
}

/** Статус и история сдачи ДЗ по одному вебинару (кнопка «Проверить статус» с сайта). */
export async function showClientCourseHomeworkLessonStatus(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  sanityLessonId: string,
  deliver?: ClientHubDeliverOptions,
  options?: { requireSubmitted?: boolean; preferredCourseSlug?: string | null },
): Promise<boolean> {
  const { resolveCourseForSanityLesson } = await import(
    '@/lib/bot/education/student-course-context'
  );
  const { findLessonBySanityId } = await import('@/lib/bot/education/course-homework');

  const preferredSlug =
    options?.preferredCourseSlug ?? deliver?.hubPayloadExtra?.activeCourseSlug ?? undefined;
  const resolved = await resolveCourseForSanityLesson(
    admin,
    telegramId,
    sanityLessonId,
    preferredSlug,
  );
  if (!resolved) return false;
  const lesson = findLessonBySanityId(resolved.content, sanityLessonId);
  if (!lesson) return false;

  const { data: progress, error } = await admin
    .from('course_lesson_student_progress')
    .select(
      'homework_status, updated_at, homework_submitted_at, homework_completed_at, review_note, submission_note, submission_file_url, homework_deadline_at',
    )
    .eq('telegram_id', telegramId)
    .eq('course_id', resolved.courseId)
    .eq('sanity_lesson_id', sanityLessonId)
    .maybeSingle();
  if (error) throw error;

  const status = (progress?.homework_status as string | undefined) ?? 'pending';
  if (
    options?.requireSubmitted &&
    status !== 'submitted' &&
    status !== 'approved' &&
    status !== 'rejected'
  ) {
    return false;
  }

  if (status === 'rejected') {
    return showClientCourseHomeworkRevision(admin, telegramId, chatId, sanityLessonId, deliver);
  }

  const courseSlug = resolved.slug;
  const courseTitle = resolved.content.title?.trim();
  const submittedAt =
    (progress?.homework_submitted_at as string | null) ??
    (status !== 'pending' ? (progress?.updated_at as string | null) : null);
  const lines = [
    '📋 Сдача ДЗ по вебинару',
    '',
    courseTitle ? `📚 ${courseTitle}` : null,
    `Вебинар №${lesson.lessonNumber}: ${lesson.title}`,
    `Статус: ${hwStatusLabel(status)}`,
    submittedAt ? `Отправлено: ${formatDateTimeShort(submittedAt)}` : null,
    progress?.homework_completed_at
      ? `Проверено: ${formatDateTimeShort(progress.homework_completed_at as string)}`
      : null,
    (progress?.submission_note as string | null)?.trim()
      ? `Комментарий: ${(progress?.submission_note as string).trim()}`
      : null,
    (progress?.submission_file_url as string | null)?.trim() ? '📎 Файл приложен' : null,
  ].filter((x): x is string => x != null);

  if (status === 'rejected' && (progress?.review_note as string | null)?.trim()) {
    lines.push(`Почему на доработке: ${(progress?.review_note as string).trim()}`);
  }
  if (status === 'approved') {
    lines.push('Результат: одобрено');
  }
  if (status === 'pending') {
    lines.push('', 'Пока нет отправленных работ по этому вебинару.');
  }

  const hubCb = `cl:chw:hub:${courseSlug}`;
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  if (status === 'submitted') {
    keyboard.push([
      { text: '👁 Посмотреть ДЗ', callback_data: `cl:chw:view:${sanityLessonId}` },
    ]);
  }
  if (status === 'rejected') {
    keyboard.push([
      { text: '📄 Посмотреть пояснение', callback_data: `cl:chw:rev:${sanityLessonId}` },
    ]);
  }
  keyboard.push([{ text: '◀️ К ДЗ', callback_data: hubCb }]);

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    `course-hw-lesson:${sanityLessonId}`,
    lines.join('\n').trim().slice(0, 3900),
    { inline_keyboard: keyboard },
    {
      ...deliver,
      hubPayloadExtra: { activeCourseSlug: courseSlug },
    },
  );
  return true;
}

/** Только просмотр отправленной работы (без повторной сдачи). */
export async function showClientCourseHomeworkSubmissionView(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  sanityLessonId: string,
  deliver?: ClientHubDeliverOptions,
  options?: { nav?: 'hub' | 'archive'; preferredCourseSlug?: string | null },
): Promise<boolean> {
  const { resolveCourseForSanityLesson } = await import(
    '@/lib/bot/education/student-course-context'
  );
  const { findLessonBySanityId } = await import('@/lib/bot/education/course-homework');

  const preferredSlug =
    options?.preferredCourseSlug ?? deliver?.hubPayloadExtra?.activeCourseSlug ?? undefined;
  const resolved = await resolveCourseForSanityLesson(
    admin,
    telegramId,
    sanityLessonId,
    preferredSlug,
  );
  if (!resolved) return false;
  const lesson = findLessonBySanityId(resolved.content, sanityLessonId);
  if (!lesson) return false;

  const { data: progress, error } = await admin
    .from('course_lesson_student_progress')
    .select(
      'homework_status, submission_note, submission_file_url, homework_submitted_at, updated_at, homework_completed_at',
    )
    .eq('telegram_id', telegramId)
    .eq('course_id', resolved.courseId)
    .eq('sanity_lesson_id', sanityLessonId)
    .maybeSingle();
  if (error) throw error;

  const status = (progress?.homework_status as string | undefined) ?? 'pending';
  const submittedAt =
    (progress?.homework_submitted_at as string | null) ??
    (status !== 'pending' ? (progress?.updated_at as string | null) : null);
  const note = (progress?.submission_note as string | null)?.trim();
  const fileRef = (progress?.submission_file_url as string | null)?.trim();

  const {
    listCourseHomeworkSubmissionEvents,
    formatCourseHomeworkSubmissionTimeline,
  } = await import('@/lib/bot/education/course-homework-submission-history');
  const events = await listCourseHomeworkSubmissionEvents(admin, telegramId, sanityLessonId, {
    courseId: resolved.courseId,
  });
  const timelineLines = formatCourseHomeworkSubmissionTimeline(events, formatDateTimeShort);

  const lines = [
    '📜 История проверок',
    '',
    `Вебинар №${lesson.lessonNumber}: ${lesson.title}`,
    `Статус: ${hwStatusLabel(status)}`,
    submittedAt ? `Последняя отправка: ${formatDateTimeShort(submittedAt)}` : null,
    progress?.homework_completed_at
      ? `Проверено: ${formatDateTimeShort(progress.homework_completed_at as string)}`
      : null,
    timelineLines.length > 0 ? '' : null,
    ...(timelineLines.length > 0 ? timelineLines : ['Записей пока нет.']),
  ].filter((x): x is string => x != null);

  const courseSlug = resolved.slug;
  const hubCb = `cl:chw:hub:${courseSlug}`;
  const histCb = `cl:chw:hist:${courseSlug}`;
  const nav = options?.nav ?? 'hub';
  const keyboard =
    nav === 'archive'
      ? [[{ text: '◀️ К архиву', callback_data: histCb }]]
      : [[{ text: '◀️ К ДЗ', callback_data: hubCb }]];

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    `course-hw-view:${sanityLessonId}`,
    lines.join('\n').trim().slice(0, 3900),
    { inline_keyboard: keyboard },
    { ...deliver, forcePush: true },
  );

  if (fileRef?.startsWith('tg:')) {
    await sendTelegramFileById(chatId, fileRef.slice(3));
  }
  return true;
}

/** Пояснение к доработке: комментарий проверяющего + действия. */
export async function showClientCourseHomeworkRevision(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  sanityLessonId: string,
  deliver?: ClientHubDeliverOptions,
  options?: { preferredCourseSlug?: string | null },
): Promise<boolean> {
  const { resolveCourseForSanityLesson } = await import(
    '@/lib/bot/education/student-course-context'
  );
  const { findLessonBySanityId } = await import('@/lib/bot/education/course-homework');

  const preferredSlug =
    options?.preferredCourseSlug ?? deliver?.hubPayloadExtra?.activeCourseSlug ?? undefined;
  const resolved = await resolveCourseForSanityLesson(
    admin,
    telegramId,
    sanityLessonId,
    preferredSlug,
  );
  if (!resolved) return false;
  const lesson = findLessonBySanityId(resolved.content, sanityLessonId);
  if (!lesson) return false;

  const { data: progress, error } = await admin
    .from('course_lesson_student_progress')
    .select('homework_status, review_note, homework_deadline_at, homework_remaining_ms')
    .eq('telegram_id', telegramId)
    .eq('course_id', resolved.courseId)
    .eq('sanity_lesson_id', sanityLessonId)
    .maybeSingle();
  if (error) throw error;

  const status = (progress?.homework_status as string | undefined) ?? 'pending';
  if (status !== 'rejected') {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'Пояснение доступно только для работ на доработке.',
    });
    return true;
  }

  const { files, text: reviewText } = unpackHomeworkReviewParts(progress?.review_note as string | null);
  const remaining =
    typeof progress?.homework_remaining_ms === 'number'
      ? progress.homework_remaining_ms
      : progress?.homework_deadline_at
        ? Math.max(0, Date.parse(progress.homework_deadline_at as string) - Date.now())
        : null;

  const courseTitle = resolved.content.title?.trim();
  const courseSlug = resolved.slug;
  const header = [
    '📄 Пояснение к доработке',
    '',
    courseTitle ? `📚 ${courseTitle}` : null,
    `Вебинар №${lesson.lessonNumber}: ${lesson.title}`,
    remaining != null ? `⏱ Осталось: ${formatRemainingMs(remaining)}` : null,
  ]
    .filter((x): x is string => x != null)
    .join('\n');

  await telegramSend('sendMessage', { chat_id: chatId, text: header });

  for (const file of files) {
    if (file.kind === 'voice') continue;
    if (file.ref.startsWith('tg:')) {
      await sendTelegramFileById(chatId, file.ref.slice(3), file.kind);
    }
  }

  if (!isPlaceholderReviewText(reviewText)) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: `💬 Комментарий:\n${reviewText.trim()}`,
    });
  }

  for (const file of files) {
    if (file.kind !== 'voice') continue;
    if (file.ref.startsWith('tg:')) {
      await sendTelegramFileById(chatId, file.ref.slice(3), 'voice');
    }
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: '❓ Задать вопрос по ДЗ', callback_data: `cl:chw:ask:${sanityLessonId}` }],
      [{ text: '📤 Отправить ДЗ', callback_data: `cl:chw:submit:${courseSlug}` }],
      [{ text: '◀️ К ДЗ', callback_data: `cl:chw:hub:${courseSlug}` }],
    ],
  };

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    `course-hw-rev:${sanityLessonId}`,
    'Выберите действие:',
    keyboard,
    { forcePush: true, hubPayloadExtra: { activeCourseSlug: courseSlug } },
  );

  return true;
}

export async function beginClientCourseHomeworkFromHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  courseSlug?: string,
): Promise<void> {
  const purchased = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
  if (!courseSlug && purchased.length > 1) {
    await showClientHomeworkMenu(admin, telegramId, chatId, { forcePush: true });
    return;
  }
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
    const loaded = await loadClientHubPayload(admin, telegramId);
    const navStack = navStackForCourseHomeworkHub(loaded?.payload.clientNavStack, slug);
    await showClientCourseHomeworkHub(
      admin,
      telegramId,
      chatId,
      { editAt, navStack, hubPayloadExtra: slug ? { activeCourseSlug: slug } : undefined },
      slug,
    );
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
  if (data === 'cl:chw:lesson') {
    const { showClientLessonHomeworkHub } = await import('./client-lesson-homework-flow');
    await showClientLessonHomeworkHub(admin, telegramId, chatId, { editAt, forcePush: true });
    return true;
  }
  if (data.startsWith('cl:chw:go:')) {
    const slug = data.slice('cl:chw:go:'.length);
    await beginClientCourseHomeworkFromHub(admin, telegramId, chatId, slug || undefined);
    return true;
  }
  const preferredCourseSlug = await activeCourseSlugFromHub(admin, telegramId);

  if (data.startsWith('cl:chw:stat:')) {
    const sanityLessonId = data.slice('cl:chw:stat:'.length);
    if (sanityLessonId) {
      await showClientCourseHomeworkLessonStatus(
        admin,
        telegramId,
        chatId,
        sanityLessonId,
        { editAt },
        { preferredCourseSlug },
      );
    }
    return true;
  }
  if (data.startsWith('cl:chw:view:')) {
    const rest = data.slice('cl:chw:view:'.length);
    const [sanityLessonId, navToken] = rest.split(':');
    if (sanityLessonId) {
      await showClientCourseHomeworkSubmissionView(
        admin,
        telegramId,
        chatId,
        sanityLessonId,
        undefined,
        {
          nav: navToken === 'a' ? 'archive' : 'hub',
          preferredCourseSlug,
        },
      );
    }
    return true;
  }
  if (data.startsWith('cl:chw:rev:')) {
    const sanityLessonId = data.slice('cl:chw:rev:'.length);
    if (sanityLessonId) {
      await showClientCourseHomeworkRevision(admin, telegramId, chatId, sanityLessonId, {
        editAt,
        hubPayloadExtra: preferredCourseSlug ? { activeCourseSlug: preferredCourseSlug } : undefined,
      });
    }
    return true;
  }
  if (data.startsWith('cl:chw:ask:')) {
    const sanityLessonId = data.slice('cl:chw:ask:'.length);
    const { resolveCourseForSanityLesson } = await import(
      '@/lib/bot/education/student-course-context'
    );
    const { findLessonBySanityId } = await import('@/lib/bot/education/course-homework');
    const resolved = sanityLessonId
      ? await resolveCourseForSanityLesson(admin, telegramId, sanityLessonId, preferredCourseSlug)
      : null;
    const lesson =
      resolved && sanityLessonId
        ? findLessonBySanityId(resolved.content, sanityLessonId)
        : null;
    await beginStudentMentorQuestion(admin, telegramId, chatId, {
      context: 'course',
      courseSlug: resolved?.slug,
      courseId: resolved?.courseId,
      homeworkLessonNumber: lesson?.lessonNumber,
      homeworkSanityLessonId: sanityLessonId || undefined,
    });
    return true;
  }
  return false;
}
