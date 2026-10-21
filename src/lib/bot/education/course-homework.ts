import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getSanityLessonSession,
  loadSanityLessonSessionMap,
  resolveWebinarSessionStatus,
  type SanityWebinarSessionStatus,
} from '@/lib/curator/lesson-session';
import {
  flattenCourseLessons,
  getDistrictCourseContent,
  type CourseLessonContent,
  type DistrictCourseContent,
} from '@/lib/studio/courseContent';
import {
  markHomeworkApproved,
  type CourseLessonStudentProgress,
  type HomeworkProgressStatus,
} from './course-progress';
import { studentHasCourseProductAccess, unlockNextCourseLessonAfterCleared } from './course-access';
import {
  collectLessonMaterialKeys,
  homeworkWebinarOpened,
  lessonHasHomework,
} from './lesson-progress-calc';
import { lookupCourseIdsBySlugs, resolveCourseIdForContent } from './course-record';
import {
  deductLifeForHomeworkFailure,
  formatLifeDeductionNote,
  getEnrollmentLives,
  isLivesTableError,
  type HomeworkLifeFailureKind,
} from './lives';
import {
  finalizeDeadlineOnApprove,
  pauseDeadlineOnSubmit,
  resumeDeadlineOnReject,
} from './homework-deadline';

export type CourseHomeworkSubmitInput = {
  note?: string;
  fileUrl?: string;
  fileKind?: 'photo' | 'document';
};

export type SubmitTargetLesson = {
  lesson: CourseLessonContent;
  progress: CourseLessonStudentProgress | null;
  courseId?: number;
  courseSlug?: string;
  courseTitle?: string;
  hasCourseProduct?: boolean;
};

export class CourseHomeworkError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_LINKED'
      | 'LESSON_NOT_FOUND'
      | 'NO_ACCESS'
      | 'NOT_READY'
      | 'ALREADY_SUBMITTED'
      | 'NOT_SUBMITTED'
      | 'NOT_ASSIGNED'
      | 'INVALID_STATUS'
      | 'NOT_REQUIRED',
  ) {
    super(message);
    this.name = 'CourseHomeworkError';
  }
}

export type CourseHomeworkLessonRef = {
  sanityLessonId: string;
  lessonNumber: number;
  title: string;
};

export function findLessonByNumber(
  content: DistrictCourseContent,
  lessonNumber: number,
): CourseLessonContent | null {
  for (const lesson of flattenCourseLessons(content)) {
    if (lesson.publicationStatus !== 'published') continue;
    if (lesson.lessonNumber === lessonNumber) return lesson;
  }
  return null;
}

export function findLessonBySanityId(
  content: DistrictCourseContent,
  sanityLessonId: string,
): CourseLessonContent | null {
  for (const lesson of flattenCourseLessons(content)) {
    if (lesson.sanityId === sanityLessonId) return lesson;
  }
  return null;
}

function hasWatchedProgress(progress: CourseLessonStudentProgress | undefined): boolean {
  return !!(progress?.live_attended_at || progress?.recording_watched_at);
}

function lessonReadyForSubmit(
  lesson: CourseLessonContent,
  progress: CourseLessonStudentProgress | undefined,
  sessionStatus?: SanityWebinarSessionStatus,
): boolean {
  if (!lesson.mandatoryHomework && !lesson.homework) return false;
  if (lesson.lessonType === 'webinar') {
    return homeworkWebinarOpened(progress);
  }
  const effective = sessionStatus ?? resolveWebinarSessionStatus(lesson.scheduledAt, null);
  if (effective !== 'completed' && !hasWatchedProgress(progress)) return false;
  return true;
}

async function loadProgress(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  courseId: number,
): Promise<CourseLessonStudentProgress | null> {
  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .select('*')
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .eq('sanity_lesson_id', sanityLessonId)
    .maybeSingle();
  if (error) throw error;
  return (data as CourseLessonStudentProgress | null) ?? null;
}

async function assertLessonAccess(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  courseId: number,
): Promise<void> {
  const { data, error } = await admin
    .from('course_lesson_access')
    .select('access_status')
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .eq('sanity_lesson_id', sanityLessonId)
    .maybeSingle();
  if (error) throw error;
  const status = data?.access_status as string | undefined;
  if (!status || status === 'revoked') {
    throw new CourseHomeworkError('Нет доступа к этому занятию.', 'NO_ACCESS');
  }
}

export async function assertHomeworkCheckerAssigned(
  admin: SupabaseClient,
  checkerTelegramId: number,
  studentTelegramId: number,
  options?: { courseId?: number | null; allowAdminPreview?: boolean },
): Promise<void> {
  const courseId = options?.courseId;

  if (courseId != null) {
    const { isStudentOnCourse } = await import('./student-course-context');
    const { staffHasCourseAccess } = await import('./course-staff');
    const onCourse = await isStudentOnCourse(admin, studentTelegramId, courseId);
    if (!onCourse) {
      throw new CourseHomeworkError('Ученик не на этом курсе.', 'NOT_ASSIGNED');
    }
    if (await staffHasCourseAccess(admin, checkerTelegramId, courseId, 'check')) {
      return;
    }
    if (options?.allowAdminPreview) {
      const { hasFullStaffPreview, loadMemberRoles } = await import('@/lib/bot/roles');
      const roles = await loadMemberRoles(admin, checkerTelegramId);
      if (hasFullStaffPreview(roles, checkerTelegramId)) return;
    }
    throw new CourseHomeworkError('Нет назначения проверяющим на этот курс.', 'NOT_ASSIGNED');
  }

  throw new CourseHomeworkError('Укажите курс для проверки ДЗ.', 'NOT_ASSIGNED');
}

export async function assertCuratorAssigned(
  admin: SupabaseClient,
  curatorTelegramId: number,
  studentTelegramId: number,
  options?: { courseId?: number | null },
): Promise<void> {
  const courseId = options?.courseId;

  if (courseId != null) {
    const { isStudentOnCourse } = await import('./student-course-context');
    const { staffHasCourseAccess } = await import('./course-staff');
    const onCourse = await isStudentOnCourse(admin, studentTelegramId, courseId);
    if (!onCourse) {
      throw new CourseHomeworkError('Ученик не на этом курсе.', 'NOT_ASSIGNED');
    }
    if (await staffHasCourseAccess(admin, curatorTelegramId, courseId, 'curator')) {
      return;
    }
    throw new CourseHomeworkError('Нет назначения куратором на этот курс.', 'NOT_ASSIGNED');
  }

  const { data, error } = await admin
    .from('mentor_assignments')
    .select('id')
    .eq('telegram_id', studentTelegramId)
    .eq('mentor_telegram_id', curatorTelegramId)
    .eq('kind', 'curator')
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (data) return;

  throw new CourseHomeworkError('Ученик не закреплён за этим куратором.', 'NOT_ASSIGNED');
}

async function collectSubmitCandidatesForContent(
  admin: SupabaseClient,
  telegramId: number,
  content: DistrictCourseContent,
  courseId: number,
  hasCourseProduct: boolean,
): Promise<Array<{ lesson: CourseLessonContent; progress: CourseLessonStudentProgress | null }>> {
  const lessons = flattenCourseLessons(content)
    .filter((l) => l.publicationStatus === 'published')
    .filter((l) => !(l.isTrialFree && !hasCourseProduct))
    .sort((a, b) => a.lessonNumber - b.lessonNumber);

  const sanityIds = lessons.map((l) => l.sanityId);
  if (sanityIds.length === 0) return [];

  const sessionMap = await loadSanityLessonSessionMap(admin, courseId, sanityIds);
  const [{ data: accessRows }, { data: progressRows }] = await Promise.all([
    admin
      .from('course_lesson_access')
      .select('sanity_lesson_id, access_status')
      .eq('telegram_id', telegramId)
      .eq('course_id', courseId)
      .in('sanity_lesson_id', sanityIds),
    admin
      .from('course_lesson_student_progress')
      .select('*')
      .eq('telegram_id', telegramId)
      .eq('course_id', courseId)
      .in('sanity_lesson_id', sanityIds),
  ]);

  const accessMap = new Map(
    (accessRows ?? []).map((r) => [r.sanity_lesson_id as string, r.access_status as string]),
  );
  const progressMap = new Map(
    (progressRows ?? []).map((r) => [r.sanity_lesson_id as string, r as CourseLessonStudentProgress]),
  );

  return lessons
    .filter((lesson) => {
      const access = accessMap.get(lesson.sanityId);
      if (!access || access === 'revoked') return false;
      const progress = progressMap.get(lesson.sanityId);
      const sessionStatus = resolveWebinarSessionStatus(
        lesson.scheduledAt,
        sessionMap.get(lesson.sanityId),
      );
      if (!lessonReadyForSubmit(lesson, progress, sessionStatus)) return false;
      const status = progress?.homework_status ?? 'pending';
      return status === 'pending' || status === 'rejected';
    })
    .map((lesson) => ({
      lesson,
      progress: progressMap.get(lesson.sanityId) ?? null,
    }));
}

/** Все занятия, по которым сейчас можно сдать ДЗ (по каждому активному курсу). */
export async function listSubmitTargetLessons(
  admin: SupabaseClient,
  telegramId: number,
): Promise<SubmitTargetLesson[]> {
  const { listStudentActiveCourseContexts } = await import('./student-course-context');
  const { studentHasCourseAccessForCourse } = await import('./course-access');

  const out: SubmitTargetLesson[] = [];
  const contexts = await listStudentActiveCourseContexts(admin, telegramId);

  for (const ctx of contexts) {
    const content = await getDistrictCourseContent(ctx.slug).catch(() => null);
    if (!content) continue;
    const hasCourseProduct = await studentHasCourseAccessForCourse(
      admin,
      telegramId,
      ctx.courseId,
    );
    const candidates = await collectSubmitCandidatesForContent(
      admin,
      telegramId,
      content,
      ctx.courseId,
      hasCourseProduct,
    );
    for (const item of candidates) {
      out.push({
        ...item,
        courseId: ctx.courseId,
        courseSlug: ctx.slug,
        courseTitle: ctx.title,
        hasCourseProduct,
      });
    }
  }

  return out.sort((a, b) => {
    const byCourse = (a.courseSlug ?? '').localeCompare(b.courseSlug ?? '');
    if (byCourse !== 0) return byCourse;
    return a.lesson.lessonNumber - b.lesson.lessonNumber;
  });
}

/** Отправлено, ожидает проверки (не в списке «сдать сейчас»). */
export async function listSubmittedAwaitingReviewForCourse(
  admin: SupabaseClient,
  telegramId: number,
  courseSlug: string,
): Promise<SubmitTargetLesson[]> {
  const { listStudentActiveCourseContexts } = await import('./student-course-context');
  const { studentHasCourseAccessForCourse } = await import('./course-access');
  const ctx = (await listStudentActiveCourseContexts(admin, telegramId)).find(
    (c) => c.slug === courseSlug,
  );
  if (!ctx) return [];
  const content = await getDistrictCourseContent(courseSlug).catch(() => null);
  if (!content) return [];
  const hasCourseProduct = await studentHasCourseAccessForCourse(admin, telegramId, ctx.courseId);
  const lessons = flattenCourseLessons(content)
    .filter((l) => l.publicationStatus === 'published')
    .filter((l) => !(l.isTrialFree && !hasCourseProduct));
  const sanityIds = lessons.map((l) => l.sanityId);
  if (sanityIds.length === 0) return [];

  const { data: progressRows } = await admin
    .from('course_lesson_student_progress')
    .select('*')
    .eq('telegram_id', telegramId)
    .eq('homework_status', 'submitted')
    .in('sanity_lesson_id', sanityIds);
  const progressMap = new Map(
    (progressRows ?? []).map((r) => [r.sanity_lesson_id as string, r as CourseLessonStudentProgress]),
  );

  return lessons
    .filter((lesson) => progressMap.has(lesson.sanityId))
    .map((lesson) => ({
      lesson,
      progress: progressMap.get(lesson.sanityId) ?? null,
      courseId: ctx.courseId,
      courseSlug: ctx.slug,
      courseTitle: ctx.title,
      hasCourseProduct,
    }));
}

export async function resolveSubmitTargetLesson(
  admin: SupabaseClient,
  telegramId: number,
  preferredSanityLessonId?: string,
  preferredCourseSlug?: string,
): Promise<SubmitTargetLesson | null> {
  if (preferredSanityLessonId) {
    const { resolveCourseForSanityLesson } = await import('./student-course-context');
    const { studentHasCourseAccessForCourse } = await import('./course-access');
    const courseCtx = await resolveCourseForSanityLesson(admin, telegramId, preferredSanityLessonId);
    if (courseCtx) {
      const hasCourseProduct = await studentHasCourseAccessForCourse(
        admin,
        telegramId,
        courseCtx.courseId,
      );
      const direct = await resolveSubmitLessonForSanityId(admin, telegramId, preferredSanityLessonId, {
        content: courseCtx.content,
        hasCourseProduct,
      });
      if (direct) {
        return {
          ...direct,
          courseId: courseCtx.courseId,
          courseSlug: courseCtx.slug,
          courseTitle: courseCtx.content.title,
          hasCourseProduct,
        };
      }
    }

    const allForLesson = await listSubmitTargetLessons(admin, telegramId);
    const match = allForLesson.find((t) => t.lesson.sanityId === preferredSanityLessonId);
    if (match) return match;
    return null;
  }

  const all = await listSubmitTargetLessons(admin, telegramId);
  if (preferredCourseSlug) {
    const forCourse = all.filter((t) => t.courseSlug === preferredCourseSlug);
    return forCourse[0] ?? null;
  }
  if (all.length === 1) return all[0] ?? null;
  return null;
}

/** Сдача по deep-link из кабинета: конкретное занятие, если оно готово к отправке. */
export async function resolveSubmitLessonForSanityId(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  cached?: {
    content: DistrictCourseContent;
    hasCourseProduct?: boolean;
    accessMap?: Map<string, string>;
    progressMap?: Map<string, CourseLessonStudentProgress>;
    sessionMap?: Map<string, import('@/lib/curator/lesson-session').SanityLessonSessionRow>;
  },
): Promise<{ lesson: CourseLessonContent; progress: CourseLessonStudentProgress | null } | null> {
  let content = cached?.content ?? null;
  let scopedCourseId: number | null = null;
  if (!content || !findLessonBySanityId(content, sanityLessonId)) {
    const { resolveCourseForSanityLesson } = await import('./student-course-context');
    const resolved = await resolveCourseForSanityLesson(admin, telegramId, sanityLessonId);
    if (resolved) {
      content = resolved.content;
      scopedCourseId = resolved.courseId;
    }
  }
  if (!content) return null;
  if (scopedCourseId == null) {
    scopedCourseId = await resolveCourseIdForContent(admin, content).catch(() => null);
  }
  if (scopedCourseId == null) return null;

  let hasCourseProduct = cached?.hasCourseProduct;
  if (hasCourseProduct === undefined) {
    const { studentHasCourseAccessForCourse } = await import('./course-access');
    hasCourseProduct = await studentHasCourseAccessForCourse(
      admin,
      telegramId,
      scopedCourseId,
    );
  }

  const lesson = findLessonBySanityId(content, sanityLessonId);
  if (!lesson || lesson.publicationStatus !== 'published') return null;
  if (lesson.isTrialFree && !hasCourseProduct) return null;

  const accessMap =
    cached?.accessMap ??
    new Map(
      (
        await admin
          .from('course_lesson_access')
          .select('sanity_lesson_id, access_status')
          .eq('telegram_id', telegramId)
          .eq('course_id', scopedCourseId)
          .eq('sanity_lesson_id', sanityLessonId)
      ).data?.map((r) => [r.sanity_lesson_id as string, r.access_status as string]) ?? [],
    );
  const access = accessMap.get(sanityLessonId);
  if (!access || access === 'revoked') return null;

  const progress =
    cached?.progressMap?.get(sanityLessonId) ??
    ((await loadProgress(
      admin,
      telegramId,
      sanityLessonId,
      scopedCourseId,
    )) as CourseLessonStudentProgress | null);
  const sessionMap =
    cached?.sessionMap ??
    (await loadSanityLessonSessionMap(admin, scopedCourseId, [sanityLessonId]));
  const sessionStatus = resolveWebinarSessionStatus(
    lesson.scheduledAt,
    sessionMap.get(sanityLessonId),
  );
  if (!lessonReadyForSubmit(lesson, progress ?? undefined, sessionStatus)) return null;
  const status = progress?.homework_status ?? 'pending';
  if (status !== 'pending' && status !== 'rejected') return null;

  return { lesson, progress };
}

async function revalidateCabinetAfterHomework(): Promise<void> {
  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/cabinet');
    revalidatePath('/cabinet/staff');
  } catch (error) {
    console.error('[course-hw] cabinet revalidate failed:', error);
  }
}

export async function markHomeworkSubmitted(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  input: CourseHomeworkSubmitInput,
  options?: { courseSlug?: string | null },
): Promise<CourseLessonStudentProgress> {
  const { resolveCourseForSanityLesson } = await import('./student-course-context');
  const { studentHasCourseAccessForCourse } = await import('./course-access');

  const resolved =
    (options?.courseSlug
      ? await (async () => {
          const content = await getDistrictCourseContent(options.courseSlug!).catch(() => null);
          if (!content) return null;
          const lesson = findLessonBySanityId(content, sanityLessonId);
          if (!lesson) return null;
          const { resolveCourseIdForContent } = await import('./course-record');
          const courseId = await resolveCourseIdForContent(admin, content);
          if (courseId == null) return null;
          return { courseId, slug: content.slug, content };
        })()
      : null) ??
    (await resolveCourseForSanityLesson(
      admin,
      telegramId,
      sanityLessonId,
      options?.courseSlug,
    ));

  if (!resolved) throw new CourseHomeworkError('Курс не найден.', 'LESSON_NOT_FOUND');
  const { content, courseId } = resolved;
  const lesson = findLessonBySanityId(content, sanityLessonId);
  if (!lesson) throw new CourseHomeworkError('Занятие не найдено.', 'LESSON_NOT_FOUND');

  const hasCourseProduct = await studentHasCourseAccessForCourse(admin, telegramId, courseId);
  if (lesson.isTrialFree && !hasCourseProduct) {
    throw new CourseHomeworkError('Сдача ДЗ доступна после покупки пакета курса.', 'NO_ACCESS');
  }

  const courseIdForGate = courseId;
  if (courseIdForGate) {
    const { loadJoinCurrentGateContext, isJoinArchiveSanityId } = await import(
      './course-enrollment-start'
    );
    const joinGate = await loadJoinCurrentGateContext(
      admin,
      telegramId,
      courseIdForGate,
      content,
    );
    if (isJoinArchiveSanityId(joinGate, sanityLessonId)) {
      throw new CourseHomeworkError(
        'Для архивного занятия домашнее задание не требуется.',
        'NOT_REQUIRED',
      );
    }
  }

  try {
    const courseId = courseIdForGate;
    if (courseId) {
      const lives = await getEnrollmentLives(admin, telegramId, courseId);
      if (lives?.fully_blocked) {
        throw new CourseHomeworkError(
          'Курс полностью заблокирован администратором. Материалы недоступны.',
          'NO_ACCESS',
        );
      }
    }
  } catch (error) {
    if (error instanceof CourseHomeworkError) throw error;
    if (!isLivesTableError(error)) throw error;
  }

  await assertLessonAccess(admin, telegramId, sanityLessonId, courseId);
  const progress = await loadProgress(admin, telegramId, sanityLessonId, courseId);
  const sessionRow = await getSanityLessonSession(admin, courseId, sanityLessonId);
  const sessionStatus = resolveWebinarSessionStatus(lesson.scheduledAt, sessionRow);
  if (!lessonReadyForSubmit(lesson, progress ?? undefined, sessionStatus)) {
    throw new CourseHomeworkError(
      'Сначала откройте вебинар в личном кабинете на сайте. После просмотра появится таймер и кнопка сдачи ДЗ.',
      'NOT_READY',
    );
  }

  const status = progress?.homework_status ?? 'pending';
  if (status === 'submitted') {
    throw new CourseHomeworkError('Домашка уже на проверке.', 'ALREADY_SUBMITTED');
  }
  if (status === 'approved') {
    throw new CourseHomeworkError('Домашка уже принята.', 'INVALID_STATUS');
  }
  if (!input.note?.trim() && !input.fileUrl?.trim()) {
    throw new CourseHomeworkError('Отправьте текст или файл.', 'NOT_READY');
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();
  // Сначала пауза дедлайна (остаток), затем статус — upsert не затирает remaining
  const { remainingMs, wasOverdue } = await pauseDeadlineOnSubmit(
    admin,
    telegramId,
    sanityLessonId,
    nowDate,
    courseId,
  );

  const row: Record<string, unknown> = {
    telegram_id: telegramId,
    course_id: courseId,
    sanity_lesson_id: sanityLessonId,
    homework_status: 'submitted',
    homework_submitted_at: now,
    submission_note: input.note?.trim() || null,
    submission_file_url: input.fileUrl?.trim() || null,
    homework_remaining_ms: remainingMs,
    updated_at: now,
  };
  if (wasOverdue) row.homework_overdue_at = now;

  const { data: existing, error: findError } = await admin
    .from('course_lesson_student_progress')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .eq('sanity_lesson_id', sanityLessonId)
    .maybeSingle();
  if (findError) {
    throw new CourseHomeworkError(
      'Не удалось сохранить отправку. Попробуйте ещё раз или сдайте через личный кабинет на сайте.',
      'NOT_READY',
    );
  }

  const payload = { ...row };
  for (let attempt = 0; attempt < 6; attempt++) {
    const writeQuery = existing?.id
      ? admin
          .from('course_lesson_student_progress')
          .update(payload)
          .eq('id', existing.id as number)
      : admin.from('course_lesson_student_progress').insert(payload);

    const { data, error } = await writeQuery.select('*').single();
    if (!error) {
      const { logCourseHomeworkSubmitted } = await import('./course-homework-submission-history');
      await logCourseHomeworkSubmitted(admin, {
        telegramId,
        sanityLessonId,
        courseId: courseIdForGate ?? null,
        note: input.note,
        fileUrl: input.fileUrl,
        submittedAt: now,
      }).catch((err) => console.error('[course-hw] submission event log failed:', err));
      await revalidateCabinetAfterHomework();
      return data as CourseLessonStudentProgress;
    }

    const msg = String(error.message ?? '');
    const missing = msg.match(/column course_lesson_student_progress\.(\w+) does not exist/);
    if (missing?.[1] && missing[1] in payload) {
      delete payload[missing[1]!];
      continue;
    }
    console.error('[course-hw] progress save failed:', error);
    throw new CourseHomeworkError(
      'Не удалось сохранить отправку. Попробуйте ещё раз или сдайте через личный кабинет на сайте.',
      'NOT_READY',
    );
  }
  throw new CourseHomeworkError(
    'Не удалось сохранить отправку. Попробуйте ещё раз или сдайте через личный кабинет на сайте.',
    'NOT_READY',
  );
}

export type CourseHomeworkReviewerRole = import('./course-progress').CourseHomeworkReviewerRole;

export async function resolveCourseHomeworkReviewerRole(
  admin: SupabaseClient,
  reviewerTelegramId: number,
  courseId?: number | null,
): Promise<CourseHomeworkReviewerRole> {
  const { loadMemberRoles, hasFullStaffPreview, memberHasRole } = await import('@/lib/bot/roles');
  const { staffHasCourseAccess } = await import('./course-staff');
  const roles = await loadMemberRoles(admin, reviewerTelegramId);
  if (hasFullStaffPreview(roles, reviewerTelegramId)) return 'admin';
  if (courseId != null) {
    if (await staffHasCourseAccess(admin, reviewerTelegramId, courseId, 'check')) return 'check';
    if (await staffHasCourseAccess(admin, reviewerTelegramId, courseId, 'curator')) return 'curator';
  }
  if (memberHasRole(roles, 'check')) return 'check';
  if (memberHasRole(roles, 'curator')) return 'curator';
  if (memberHasRole(roles, 'teacher')) return 'teacher';
  return 'check';
}

export async function markHomeworkRejected(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  note?: string,
  reviewer?: { telegramId: number; role: CourseHomeworkReviewerRole },
  courseId?: number | null,
): Promise<CourseLessonStudentProgress> {
  let resolvedCourseId = courseId ?? null;
  if (resolvedCourseId == null) {
    const { resolveCourseForSanityLesson } = await import('./student-course-context');
    const resolved = await resolveCourseForSanityLesson(admin, telegramId, sanityLessonId);
    resolvedCourseId = resolved?.courseId ?? null;
  }
  if (resolvedCourseId == null) {
    throw new CourseHomeworkError('Курс не найден.', 'LESSON_NOT_FOUND');
  }
  const progress = await loadProgress(admin, telegramId, sanityLessonId, resolvedCourseId);
  if (!progress || progress.homework_status !== 'submitted') {
    throw new CourseHomeworkError('Нет домашки на проверке.', 'NOT_SUBMITTED');
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const { logCourseHomeworkRevisionRequested } = await import('./course-homework-submission-history');
  if (reviewer?.telegramId != null && reviewer.role) {
    await logCourseHomeworkRevisionRequested(admin, {
      telegramId,
      sanityLessonId,
      courseId: resolvedCourseId,
      submissionNote: progress.submission_note ?? null,
      submissionFileUrl: progress.submission_file_url ?? null,
      reviewerTelegramId: reviewer.telegramId,
      reviewerRole: reviewer.role,
      reviewerComment: note,
      createdAt: now,
    }).catch((err) => console.error('[course-hw] revision event log failed:', err));
  }
  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .update({
      homework_status: 'rejected',
      review_note: note?.trim() || null,
      updated_at: now,
      reviewed_by_telegram_id: reviewer?.telegramId ?? null,
      reviewed_at: reviewer?.telegramId != null ? now : null,
      reviewer_role: reviewer?.role ?? null,
    })
    .eq('telegram_id', telegramId)
    .eq('course_id', resolvedCourseId)
    .eq('sanity_lesson_id', sanityLessonId)
    .select('*')
    .single();
  if (error) throw error;

  const resumed = await resumeDeadlineOnReject(
    admin,
    telegramId,
    sanityLessonId,
    nowDate,
    resolvedCourseId,
  );
  if (resumed.immediatelyOverdue) {
    const { notifyCuratorOverdueOnce } = await import('./homework-deadline-notify');
    void notifyCuratorOverdueOnce(admin, telegramId, sanityLessonId, resolvedCourseId).catch(
      (err) => console.error('[courseHomework] overdue notify on reject failed:', err),
    );
  }

  return (resumed.progress as CourseLessonStudentProgress | null) ?? (data as CourseLessonStudentProgress);
}

async function resolveContentForHomeworkReview(
  admin: SupabaseClient,
  studentTelegramId: number,
  lessonNumber: number,
  options?: { courseId?: number | null; courseSlug?: string | null },
): Promise<{ content: DistrictCourseContent; courseId: number | null }> {
  const slugOpt = options?.courseSlug?.trim();
  if (slugOpt) {
    const content = await getDistrictCourseContent(slugOpt);
    if (!content) throw new CourseHomeworkError('Курс не найден.', 'LESSON_NOT_FOUND');
    const courseId =
      options?.courseId ??
      (await resolveCourseIdForContent(admin, content).catch(() => null));
    return { content, courseId };
  }

  if (options?.courseId != null) {
    const { data: row } = await admin
      .from('courses')
      .select('slug')
      .eq('id', options.courseId)
      .maybeSingle();
    const slug = (row?.slug as string | undefined)?.trim();
    if (slug) {
      const content = await getDistrictCourseContent(slug);
      if (content) return { content, courseId: options.courseId };
    }
  }

  const { listStudentActiveCourseContexts } = await import('./student-course-context');
  const contexts = await listStudentActiveCourseContexts(admin, studentTelegramId);
  for (const ctx of contexts) {
    const content = await getDistrictCourseContent(ctx.slug).catch(() => null);
    if (!content) continue;
    const lesson = findLessonByNumber(content, lessonNumber);
    if (!lesson) continue;
    const progress = await loadProgress(
      admin,
      studentTelegramId,
      lesson.sanityId,
      ctx.courseId,
    );
    if (progress?.homework_status === 'submitted') {
      return { content, courseId: ctx.courseId };
    }
  }

  throw new CourseHomeworkError('Курс не найден.', 'LESSON_NOT_FOUND');
}

export async function approveCourseHomeworkByCurator(
  admin: SupabaseClient,
  curatorTelegramId: number,
  studentTelegramId: number,
  lessonNumber: number,
  options?: { courseId?: number | null; courseSlug?: string | null },
): Promise<{ lesson: CourseLessonContent; progress: CourseLessonStudentProgress }> {
  const { content, courseId: resolvedFromContent } = await resolveContentForHomeworkReview(
    admin,
    studentTelegramId,
    lessonNumber,
    options,
  );
  const lesson = findLessonByNumber(content, lessonNumber);
  if (!lesson) throw new CourseHomeworkError(`Занятие №${lessonNumber} не найдено.`, 'LESSON_NOT_FOUND');

  const { loadMemberRoles, hasFullStaffPreview } = await import('@/lib/bot/roles');
  const roles = await loadMemberRoles(admin, curatorTelegramId);
  const resolvedCourseId = options?.courseId ?? resolvedFromContent;
  await assertHomeworkCheckerAssigned(admin, curatorTelegramId, studentTelegramId, {
    courseId: resolvedCourseId,
    allowAdminPreview: hasFullStaffPreview(roles, curatorTelegramId),
  });
  if (resolvedCourseId == null) {
    throw new CourseHomeworkError('Курс не найден.', 'LESSON_NOT_FOUND');
  }
  const progress = await loadProgress(
    admin,
    studentTelegramId,
    lesson.sanityId,
    resolvedCourseId,
  );
  if (!progress || progress.homework_status !== 'submitted') {
    throw new CourseHomeworkError('Нет домашки на проверке.', 'NOT_SUBMITTED');
  }
  const reviewerRole = await resolveCourseHomeworkReviewerRole(
    admin,
    curatorTelegramId,
    resolvedCourseId,
  );
  const updated = await markHomeworkApproved(
    admin,
    studentTelegramId,
    { courseId: resolvedCourseId, sanityLessonId: lesson.sanityId },
    undefined,
    {
      materialKeys: collectLessonMaterialKeys(lesson),
      hasHomework: lessonHasHomework(lesson),
      reviewerTelegramId: curatorTelegramId,
      reviewerRole,
    },
  );
  await finalizeDeadlineOnApprove(
    admin,
    studentTelegramId,
    lesson.sanityId,
    resolvedCourseId,
  );

  try {
    if (resolvedCourseId) {
      await unlockNextCourseLessonAfterCleared(admin, studentTelegramId, resolvedCourseId, content);
    }
  } catch (error) {
    console.error('[courseHomework] unlock next after approve failed:', error);
  }

  const { logCourseHomeworkApproved } = await import('./course-homework-submission-history');
  await logCourseHomeworkApproved(admin, {
    telegramId: studentTelegramId,
    sanityLessonId: lesson.sanityId,
    courseId: resolvedCourseId ?? null,
    submissionNote: updated.submission_note ?? null,
    submissionFileUrl: updated.submission_file_url ?? null,
    reviewerTelegramId: curatorTelegramId,
    reviewerRole,
    reviewerComment: updated.review_note ?? null,
  }).catch((err) => console.error('[course-hw] approve event log failed:', err));

  await revalidateCabinetAfterHomework();
  return { lesson, progress: updated };
}

export type HomeworkLifeDeductionResult = {
  deducted: boolean;
  livesCurrent: number;
  livesMax: number;
  accessBlocked: boolean;
};

export async function rejectCourseHomeworkByCurator(
  admin: SupabaseClient,
  curatorTelegramId: number,
  studentTelegramId: number,
  lessonNumber: number,
  note?: string,
  options?: { courseId?: number | null; courseSlug?: string | null },
): Promise<{
  lesson: CourseLessonContent;
  progress: CourseLessonStudentProgress;
  lifeDeduction: HomeworkLifeDeductionResult | null;
}> {
  const { content, courseId: resolvedFromContent } = await resolveContentForHomeworkReview(
    admin,
    studentTelegramId,
    lessonNumber,
    options,
  );
  const lesson = findLessonByNumber(content, lessonNumber);
  if (!lesson) throw new CourseHomeworkError(`Занятие №${lessonNumber} не найдено.`, 'LESSON_NOT_FOUND');

  const { loadMemberRoles, hasFullStaffPreview } = await import('@/lib/bot/roles');
  const roles = await loadMemberRoles(admin, curatorTelegramId);
  const resolvedCourseId = options?.courseId ?? resolvedFromContent;
  await assertHomeworkCheckerAssigned(admin, curatorTelegramId, studentTelegramId, {
    courseId: resolvedCourseId,
    allowAdminPreview: hasFullStaffPreview(roles, curatorTelegramId),
  });
  // Reject только возобновляет таймер; жизнь за просрочку — вручную.
  const reviewerRole = await resolveCourseHomeworkReviewerRole(
    admin,
    curatorTelegramId,
    resolvedCourseId,
  );
  const updated = await markHomeworkRejected(admin, studentTelegramId, lesson.sanityId, note, {
    telegramId: curatorTelegramId,
    role: reviewerRole,
  });
  await revalidateCabinetAfterHomework();
  return { lesson, progress: updated, lifeDeduction: null };
}

export async function deductLifeForHomeworkDebtByCurator(
  admin: SupabaseClient,
  curatorTelegramId: number,
  studentTelegramId: number,
  sanityLessonId: string,
  failureKind: Extract<HomeworkLifeFailureKind, 'notSubmitted' | 'notCompleted' | 'overdue'> = 'overdue',
  options?: { courseId?: number | null },
): Promise<{ lifeDeduction: HomeworkLifeDeductionResult | null }> {
  await assertCuratorAssigned(admin, curatorTelegramId, studentTelegramId, {
    courseId: options?.courseId,
  });
  const lifeDeduction = await tryDeductLifeForHomework(
    admin,
    curatorTelegramId,
    studentTelegramId,
    sanityLessonId,
    failureKind,
    options?.courseId,
  );
  return { lifeDeduction };
}

export async function deductLifeForHomeworkDebtByChecker(
  admin: SupabaseClient,
  checkerTelegramId: number,
  studentTelegramId: number,
  sanityLessonId: string,
  failureKind: Extract<HomeworkLifeFailureKind, 'notSubmitted' | 'notCompleted' | 'overdue'> = 'overdue',
  options?: { courseId?: number | null; courseSlug?: string | null },
): Promise<{ lifeDeduction: HomeworkLifeDeductionResult | null }> {
  const { loadMemberRoles, hasFullStaffPreview } = await import('@/lib/bot/roles');
  const roles = await loadMemberRoles(admin, checkerTelegramId);
  await assertHomeworkCheckerAssigned(admin, checkerTelegramId, studentTelegramId, {
    courseId: options?.courseId,
    allowAdminPreview: hasFullStaffPreview(roles, checkerTelegramId),
  });
  const lifeDeduction = await tryDeductLifeForHomework(
    admin,
    checkerTelegramId,
    studentTelegramId,
    sanityLessonId,
    failureKind,
    options?.courseId,
    options?.courseSlug,
  );
  return { lifeDeduction };
}

export async function addCourseHomeworkReviewComment(
  admin: SupabaseClient,
  checkerTelegramId: number,
  studentTelegramId: number,
  lessonNumber: number,
  note: string,
  options?: { courseId?: number | null; courseSlug?: string | null },
): Promise<{ lesson: CourseLessonContent }> {
  const trimmed = note.trim();
  if (!trimmed) throw new CourseHomeworkError('Комментарий пустой.', 'NOT_SUBMITTED');

  const slug = options?.courseSlug ?? undefined;
  const content = await getDistrictCourseContent(slug);
  if (!content) throw new CourseHomeworkError('Курс не найден.', 'LESSON_NOT_FOUND');
  const lesson = findLessonByNumber(content, lessonNumber);
  if (!lesson) throw new CourseHomeworkError(`Занятие №${lessonNumber} не найдено.`, 'LESSON_NOT_FOUND');

  const { loadMemberRoles, hasFullStaffPreview } = await import('@/lib/bot/roles');
  const roles = await loadMemberRoles(admin, checkerTelegramId);
  await assertHomeworkCheckerAssigned(admin, checkerTelegramId, studentTelegramId, {
    courseId: options?.courseId,
    allowAdminPreview: hasFullStaffPreview(roles, checkerTelegramId),
  });

  const resolvedCourseId =
    options?.courseId ?? (await resolveCourseIdForContent(admin, content).catch(() => null));
  if (resolvedCourseId == null) {
    throw new CourseHomeworkError('Курс не найден.', 'LESSON_NOT_FOUND');
  }

  const progress = await loadProgress(
    admin,
    studentTelegramId,
    lesson.sanityId,
    resolvedCourseId,
  );
  if (!progress) {
    throw new CourseHomeworkError('У ученика нет прогресса по этому занятию.', 'NOT_SUBMITTED');
  }

  const now = new Date().toISOString();
  const reviewerRole = await resolveCourseHomeworkReviewerRole(
    admin,
    checkerTelegramId,
    resolvedCourseId,
  );

  const { error } = await admin
    .from('course_lesson_student_progress')
    .update({
      review_note: trimmed,
      updated_at: now,
      reviewed_by_telegram_id: checkerTelegramId,
      reviewed_at: now,
      reviewer_role: reviewerRole,
    })
    .eq('telegram_id', studentTelegramId)
    .eq('course_id', resolvedCourseId)
    .eq('sanity_lesson_id', lesson.sanityId);
  if (error) throw error;

  return { lesson };
}

async function tryDeductLifeForHomework(
  admin: SupabaseClient,
  actorTelegramId: number,
  studentTelegramId: number,
  sanityLessonId: string,
  failureKind: HomeworkLifeFailureKind,
  courseIdOverride?: number | null,
  courseSlug?: string | null,
): Promise<HomeworkLifeDeductionResult | null> {
  const content = await getDistrictCourseContent(courseSlug ?? undefined);
  if (!content) return null;
  const courseId =
    courseIdOverride ?? (await resolveCourseIdForContent(admin, content).catch(() => null));
  if (!courseId) return null;

  try {
    const { state, deducted } = await deductLifeForHomeworkFailure(admin, {
      telegramId: studentTelegramId,
      courseId,
      curatorTelegramId: actorTelegramId,
      sanityLessonId,
      failureKind,
    });
    return {
      deducted,
      livesCurrent: state.lives_current,
      livesMax: state.lives_max,
      accessBlocked: state.access_blocked,
    };
  } catch (error) {
    if (isLivesTableError(error)) return null;
    throw error;
  }
}

export { formatLifeDeductionNote };

export function mapProgressToCuratorStatus(
  lesson: CourseLessonContent,
  progress: CourseLessonStudentProgress | undefined,
  hasAccess: boolean,
  sessionStatus?: SanityWebinarSessionStatus,
): HomeworkProgressStatus | 'waiting' | 'upcoming' {
  if (!hasAccess) return 'upcoming';
  const status = progress?.homework_status ?? 'pending';
  if (status === 'approved') return 'approved';
  if (status === 'submitted') return 'submitted';
  if (status === 'rejected') return 'rejected';
  if (lessonReadyForSubmit(lesson, progress, sessionStatus)) return 'pending';
  return 'upcoming';
}

export const HOMEWORK_STATUS_LABELS: Record<HomeworkProgressStatus, { state: string; tone: 'ok' | 'now' }> = {
  pending: { state: 'Не сдано', tone: 'now' },
  submitted: { state: 'На проверке', tone: 'now' },
  approved: { state: 'Принято', tone: 'ok' },
  rejected: { state: 'На доработке', tone: 'now' },
};
