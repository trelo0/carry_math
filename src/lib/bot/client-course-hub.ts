import type { SupabaseClient } from '@supabase/supabase-js';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import {
  flattenCourseLessons,
  getDistrictCourseContent,
} from '@/lib/studio/courseContent';
import { resolveCourseIdForContent } from '@/lib/bot/education/course-record';
import { getEnrollmentLives, isLivesTableError } from '@/lib/bot/education/lives';
import { resolveSubmitTargetLesson } from '@/lib/bot/education/course-homework';
import { deadlineUiState } from '@/lib/bot/education/homework-deadline';
import type { HomeworkProgressStatus } from '@/lib/bot/education/course-progress';
import {
  loadSanityLessonSessionMap,
  resolveWebinarSessionStatus,
} from '@/lib/curator/lesson-session';
import {
  clientBackButton,
  deliverClientHubScreen,
  type ClientHubDeliverOptions,
} from './client-nav';
import {
  aggregateCourseProgress,
  computeLessonProgressPercent,
  homeworkRequiredForLesson,
} from './education/lesson-progress-calc';
import {
  studentHasCourseAccessForCourse,
  sumCoursePackageRemainingLessons,
} from './education/course-access';
import { syncCourseStaffFromContent } from './education/course-staff';
import { listStudentPurchasedVisibleCourseContexts } from './education/student-course-context';
import { listSubmitTargetLessons } from './education/course-homework';
import { formatDateTimeShort, formatRemainingMs } from './client-format';
import { getClientProductMode, resolveClientState } from './client-state';

function courseHwStatusLine(
  phase: ReturnType<typeof deadlineUiState>,
  remainingMs: number | null,
): string {
  switch (phase) {
    case 'waiting_review':
      return '⏳ ДЗ на проверке — ждите ответа куратора';
    case 'revision':
      return `✏️ Нужна доработка${remainingMs != null ? ` · осталось ${formatRemainingMs(remainingMs)}` : ''}`;
    case 'approved':
      return '✅ ДЗ принято — можно переходить дальше';
    case 'overdue':
      return '⏱ Срок сдачи ДЗ истёк';
    case 'soon':
    case 'ok':
      return `📝 Нужно сдать ДЗ · осталось ${formatRemainingMs(remainingMs)}`;
    default:
      return 'ДЗ по текущему занятию не ожидается';
  }
}

export async function showClientCoursePicker(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const courses = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
  if (courses.length <= 1) {
    await showClientMyCourseHub(admin, telegramId, chatId, deliver, courses[0]?.slug);
    return;
  }

  const lines = ['🎓 Мои курсы', '', 'Выберите курс:'];
  const keyboard = {
    inline_keyboard: [
      ...courses.map((c) => [
        { text: c.title.slice(0, 58), callback_data: `cl:course:open:${c.slug}` },
      ]),
      [clientBackButton()],
    ],
  };
  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'my-course-pick',
    lines.join('\n'),
    keyboard,
    deliver,
  );
}

export async function showClientMyCourseHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
  courseSlug?: string,
): Promise<void> {
  const state = await resolveClientState(admin, telegramId);
  const purchased = await listStudentPurchasedVisibleCourseContexts(admin, telegramId);
  if (!state.hasActiveCourse || purchased.length === 0) {
    await deliverClientHubScreen(
      admin,
      telegramId,
      chatId,
      'my-course-denied',
      '🎓 Мой курс\n\nРаздел доступен после подключения онлайн-курса.',
      { inline_keyboard: [[clientBackButton()]] },
      deliver,
    );
    return;
  }

  if (purchased.length > 1 && !courseSlug) {
    await showClientCoursePicker(admin, telegramId, chatId, deliver);
    return;
  }

  const slug = courseSlug ?? purchased[0]!.slug;
  const content = await getDistrictCourseContent(slug).catch(() => null);
  const courseId = content ? await resolveCourseIdForContent(admin, content).catch(() => null) : null;
  if (courseId && content) {
    await syncCourseStaffFromContent(admin, courseId, content, { courseSlug: slug }).catch(() => {});
  }
  const lessons = content
    ? flattenCourseLessons(content).filter((l) => l.publicationStatus === 'published')
    : [];

  let livesCurrent: number | null = null;
  let livesMax: number | null = null;
  if (courseId) {
    try {
      const lives = await getEnrollmentLives(admin, telegramId, courseId);
      livesCurrent = lives?.lives_current ?? null;
      livesMax = lives?.lives_max ?? null;
    } catch (error) {
      if (!isLivesTableError(error)) throw error;
    }
  }

  const sanityIdsForCourse = lessons.map((l) => l.sanityId);
  const { data: progressRows } = sanityIdsForCourse.length
    ? await admin
        .from('course_lesson_student_progress')
        .select(
          'sanity_lesson_id, completed_at, homework_status, homework_remaining_ms, homework_deadline_at, homework_overdue_at, live_attended_at, recording_watched_at, watch_percent, materials_opened',
        )
        .eq('telegram_id', telegramId)
        .in('sanity_lesson_id', sanityIdsForCourse)
    : { data: [] as Array<Record<string, unknown>> };

  const progressBySanity = new Map(
    (progressRows ?? []).map((r) => [r.sanity_lesson_id as string, r]),
  );
  const hasCourseProduct =
    courseId != null ? await studentHasCourseAccessForCourse(admin, telegramId, courseId) : false;

  const lessonPercents = lessons.map((lesson) => {
    const p = progressBySanity.get(lesson.sanityId);
    const hasHw = homeworkRequiredForLesson(lesson, hasCourseProduct);
    return computeLessonProgressPercent({
      recordingWatchedAt: (p?.recording_watched_at as string | null) ?? null,
      liveAttendedAt: (p?.live_attended_at as string | null) ?? null,
      materialsOpened: (p?.materials_opened as string[] | null) ?? null,
      homeworkStatus: (p?.homework_status as HomeworkProgressStatus | null) ?? null,
      hasHomework: hasHw,
    });
  });
  const { coursePercent, completedCount, totalLessons } = aggregateCourseProgress(lessonPercents);
  const total = totalLessons || lessons.length;
  const percent = coursePercent;
  const completed = completedCount;

  const now = Date.now();
  const sanityIds = lessons.map((l) => l.sanityId);
  const sessionMap =
    sanityIds.length > 0 && courseId
      ? await loadSanityLessonSessionMap(admin, courseId, sanityIds)
      : new Map();
  const { data: accessRows } = sanityIds.length
    ? await admin
        .from('course_lesson_access')
        .select('sanity_lesson_id, access_status')
        .eq('telegram_id', telegramId)
        .in('sanity_lesson_id', sanityIds)
    : { data: [] as Array<{ sanity_lesson_id: string; access_status: string }> };
  const accessMap = new Map(
    (accessRows ?? []).map((r) => [r.sanity_lesson_id as string, r.access_status as string]),
  );

  const upcoming = lessons
    .filter((l) => {
      const at = l.scheduledAt ? Date.parse(l.scheduledAt) : NaN;
      if (!Number.isFinite(at) || at < now) return false;
      const status = resolveWebinarSessionStatus(l.scheduledAt, sessionMap.get(l.sanityId));
      return status !== 'completed' && status !== 'cancelled';
    })
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
  const nextWebinar = upcoming[0] ?? null;
  const nextAccess = nextWebinar ? accessMap.get(nextWebinar.sanityId) : null;
  const nextAccessLabel =
    !nextWebinar
      ? null
      : nextAccess === 'available'
        ? 'доступ открыт'
        : nextAccess === 'blocked_lives'
          ? 'доступ ограничен (жизни)'
          : 'доступ пока закрыт (нужно одобренное ДЗ предыдущего занятия)';

  const courseTargets = (await listSubmitTargetLessons(admin, telegramId)).filter(
    (t) => t.courseSlug === slug,
  );
  let hwLine = '📝 Домашние задания: всё сдано или сдача пока не открыта';
  if (courseTargets.length > 1) {
    hwLine = ['📝 Нужно сдать ДЗ:', ...courseTargets.map(
      (t) => `• №${t.lesson.lessonNumber} «${t.lesson.title}»`,
    )].join('\n');
  } else if (courseTargets.length === 1) {
    const target = courseTargets[0]!;
    const progress = target.progress;
    const phase = deadlineUiState(progress);
    const remaining =
      typeof progress?.homework_remaining_ms === 'number'
        ? progress.homework_remaining_ms
        : progress?.homework_deadline_at
          ? Math.max(0, Date.parse(progress.homework_deadline_at) - now)
          : null;
    hwLine = `📝 ДЗ №${target.lesson.lessonNumber} «${target.lesson.title}»\n${courseHwStatusLine(phase, remaining)}`;
  } else if (courseTargets.length === 0) {
    const latestSubmitted = [...progressBySanity.values()]
      .filter((r) => r.homework_status === 'submitted' || r.homework_status === 'approved')
      .sort((a, b) => String(b.sanity_lesson_id).localeCompare(String(a.sanity_lesson_id)))[0];
    const rejected = [...progressBySanity.values()].find((r) => r.homework_status === 'rejected');
    if (rejected) {
      hwLine = '✏️ Есть ДЗ на доработке — откройте раздел «Домашние задания»';
    } else if (latestSubmitted?.homework_status === 'submitted') {
      hwLine = '⏳ ДЗ на проверке';
    } else if (latestSubmitted?.homework_status === 'approved') {
      hwLine = '✅ Последнее ДЗ принято';
    }
  }

  const livesLabel =
    livesCurrent == null ? '—' : `${livesCurrent}${livesMax != null ? `/${livesMax}` : ''}`;

  let packageLine: string | null = null;
  if (courseId) {
    try {
      const pkg = await sumCoursePackageRemainingLessons(admin, telegramId, courseId);
      if (pkg.total > 0) {
        packageLine = `📦 Пакет: ${pkg.remaining} из ${pkg.total} занятий`;
      }
    } catch {
      /* ignore */
    }
  }

  const lines = [
    '🎓 Мой курс',
    content?.title ? `📚 ${content.title}` : null,
    '',
    `📊 Прогресс: ${completed}/${total} (${percent}%)`,
    `❤️ Жизни: ${livesLabel}`,
    packageLine,
    '',
    nextWebinar
      ? `⏭ Ближайший вебинар: №${nextWebinar.lessonNumber} «${nextWebinar.title}»\n   ${formatDateTimeShort(nextWebinar.scheduledAt)}\n   ${nextAccessLabel}`
      : '⏭ Ближайший вебинар: не запланирован',
    '',
    hwLine,
  ].filter((x): x is string => x != null);

  const cabinetUrl = await createCabinetLoginUrl(
    admin,
    telegramId,
    `/cabinet?section=course&course=${encodeURIComponent(slug)}`,
  ).catch(() => null);

  const rows: Array<Array<Record<string, string>>> = [];
  if (purchased.length > 1) {
    rows.push([{ text: '◀️ К списку курсов', callback_data: 'cl:course:pick' }]);
  }
  if (cabinetUrl) {
    rows.push([{ text: '🌐 Открыть кабинет курса', url: cabinetUrl }]);
  }
  rows.push([{ text: '💬 Связаться с куратором', callback_data: `cl:course:ask:${slug}` }]);
  if (purchased.length <= 1) {
    rows.push([{ text: '🏠 Главное меню', callback_data: 'cl:home' }]);
  }

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'my-course-detail',
    lines.join('\n'),
    { inline_keyboard: rows },
    { ...deliver, hubPayloadExtra: { activeCourseSlug: slug } },
  );
}

export function isClientCourseHubCallback(data: string): boolean {
  return (
    data === 'cl:course:pick' ||
    data === 'cl:course:mine' ||
    data.startsWith('cl:course:open:')
  );
}

export async function handleClientCourseHubCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  messageId: number,
  telegramId: number,
): Promise<boolean> {
  if (!isClientCourseHubCallback(data)) return false;
  const editAt = { chatId, messageId };
  if (data === 'cl:course:pick' || data === 'cl:course:mine') {
    await showClientCoursePicker(admin, telegramId, chatId, { editAt });
    return true;
  }
  if (data.startsWith('cl:course:open:')) {
    const slug = data.slice('cl:course:open:'.length);
    await showClientMyCourseHub(admin, telegramId, chatId, { editAt }, slug || undefined);
    return true;
  }
  return false;
}
