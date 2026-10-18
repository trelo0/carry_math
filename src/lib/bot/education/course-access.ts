import type { SupabaseClient } from '@supabase/supabase-js';
import type { CourseLessonContent, DistrictCourseContent } from '@/lib/studio/courseContent';
import { DISTRICT_COURSE_SLUG, flattenCourseLessons } from '@/lib/studio/courseContent';
import { revokeAccess } from '@/lib/bot/accesses';
import type { CourseLessonStudentProgress } from './course-progress';
import { homeworkRequiredForLesson, isLessonProgressCompleted } from './lesson-progress-calc';
import { getEnrollmentLives, resetEnrollmentStateForRepurchase } from './lives';

export type LessonAccessSource = 'enrollment' | 'package' | 'bonus';
export type LessonAccessStatus = 'available' | 'blocked_lives' | 'revoked';

export type CourseLessonAccessRow = {
  id: number;
  telegram_id: number;
  course_lesson_id: number | null;
  sanity_lesson_id: string | null;
  access_status: LessonAccessStatus;
  source: LessonAccessSource;
  package_id: number | null;
  granted_at: string;
};

export function isCourseAccessTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return (
    message.includes('course_lesson_access') ||
    message.includes('package_lesson_grants') ||
    message.includes('course_lessons') ||
    message.includes('sanity_lesson_id') ||
    message.includes('does not exist') ||
    message.includes('Could not find')
  );
}

/** Урок завершён: материал 100% + ДЗ approved (или без ДЗ — только материал 100%). */
export function isCourseLessonCleared(
  lesson: Pick<
    CourseLessonContent,
    'isTrialFree' | 'mandatoryHomework' | 'homework' | 'materials' | 'homeworkFiles'
  >,
  progress: CourseLessonStudentProgress | undefined | null,
  options?: { hasCourseProduct?: boolean },
): boolean {
  const hasCourseProduct = options?.hasCourseProduct ?? true;
  if (!progress) return false;
  if (progress.completed_at) return true;
  return isLessonProgressCompleted({
    recordingWatchedAt: progress.recording_watched_at,
    liveAttendedAt: progress.live_attended_at,
    homeworkStatus: progress.homework_status,
    hasHomework: homeworkRequiredForLesson(lesson, hasCourseProduct),
  });
}

export function isLegacyDistrictCourseSlug(courseSlug: string | null | undefined): boolean {
  return courseSlug === DISTRICT_COURSE_SLUG || courseSlug === 'kurs-district';
}

/** Пакет course относится к курсу (course_id, legacy null для основного slug, совпадение title). */
export function courseLessonPackageMatchesCourse(
  pkgCourseId: number | null | undefined,
  pkgTitle: string | null | undefined,
  courseId: number,
  courseSlug: string | null | undefined,
  courseTitle?: string | null,
): boolean {
  if (pkgCourseId === courseId) return true;
  if (pkgCourseId != null) return false;
  if (isLegacyDistrictCourseSlug(courseSlug)) return true;
  const pt = pkgTitle?.trim();
  const ct = courseTitle?.trim();
  if (pt && ct && pt === ct) return true;
  return false;
}

/** Все id строк courses, относящихся к тому же курсу (slug / sanity_id). */
export async function expandCourseIdAliases(
  admin: SupabaseClient,
  courseId: number,
): Promise<number[]> {
  const { data: row } = await admin
    .from('courses')
    .select('id, slug, sanity_id')
    .eq('id', courseId)
    .maybeSingle();
  if (!row) return [courseId];
  const sanityId = (row.sanity_id as string | null | undefined)?.trim();
  if (sanityId) {
    const { data: rows } = await admin.from('courses').select('id').eq('sanity_id', sanityId);
    const ids = (rows ?? []).map((r) => r.id as number);
    if (ids.length > 0) return ids;
  }
  const slug = (row.slug as string | null | undefined)?.trim();
  if (slug) {
    const { data: rows } = await admin.from('courses').select('id').eq('slug', slug);
    const ids = (rows ?? []).map((r) => r.id as number);
    if (ids.length > 0) return ids;
  }
  return [courseId];
}

export function coursePackageRowMatchesCourse(
  pkgCourseId: number | null | undefined,
  pkgTitle: string | null | undefined,
  courseId: number,
  courseSlug: string | null | undefined,
  courseTitle: string | null | undefined,
  aliasIds: ReadonlySet<number>,
  slugByPkgCourseId: ReadonlyMap<number, string>,
): boolean {
  if (pkgCourseId != null) {
    if (aliasIds.has(pkgCourseId)) return true;
    const targetSlug = courseSlug?.trim();
    const pkgSlug = slugByPkgCourseId.get(pkgCourseId)?.trim();
    if (targetSlug && pkgSlug && targetSlug === pkgSlug) return true;
    return false;
  }
  return courseLessonPackageMatchesCourse(
    null,
    pkgTitle,
    courseId,
    courseSlug,
    courseTitle,
  );
}

export function previousCourseLessonsCleared(
  lessons: CourseLessonContent[],
  index: number,
  progressMap: Map<string, CourseLessonStudentProgress | undefined>,
  options?: { hasCourseProduct?: boolean; gateStartIndex?: number },
): boolean {
  const hasCourseProduct = options?.hasCourseProduct ?? true;
  const from = Math.max(0, options?.gateStartIndex ?? 0);
  for (let i = from; i < index; i += 1) {
    const prev = lessons[i];
    if (!prev) continue;
    if (!isCourseLessonCleared(prev, progressMap.get(prev.sanityId), { hasCourseProduct })) {
      return false;
    }
  }
  return true;
}

/** Оплачен курс: доступ product=course или активный пакет занятий курса. */
export async function studentHasCourseProductAccess(
  admin: SupabaseClient,
  telegramId: number,
): Promise<boolean> {
  const { data: packageRows, error: packageError } = await admin
    .from('lesson_packages')
    .select('product, total_lessons, status')
    .eq('telegram_id', telegramId)
    .eq('product', 'course')
    .neq('status', 'cancelled');
  if (packageError) throw packageError;
  return (packageRows ?? []).some((row) => (row.total_lessons as number) > 0);
}

/**
 * Если нет оплаченной квоты (sum total_lessons по course-пакетам = 0) — сброс join_current / прогресса / access.
 * Пустые или «обнулённые» строки lesson_packages сами по себе не блокируют сброс.
 */
export async function resetCourseWhenNoPaidPackages(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  content?: DistrictCourseContent | null,
): Promise<boolean> {
  const entitlement = await sumCoursePackageLessonEntitlement(admin, telegramId, courseId);
  if (entitlement > 0) return false;

  try {
    await revokeAccess(admin, telegramId, 'course');
  } catch (error) {
    if (!String((error as Error)?.message ?? '').includes('user_accesses')) throw error;
  }

  const { error: enrollmentError } = await admin
    .from('course_enrollments')
    .update({
      purchase_scenario: null,
      start_module_id: null,
      start_lesson_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId);
  if (enrollmentError && !String(enrollmentError.message ?? '').includes('does not exist')) {
    throw enrollmentError;
  }

  await resetCourseLearningForRepurchase(admin, telegramId, courseId, content);
  return true;
}

/** Сколько занятий курса оплачено (сумма total по активным и завершённым пакетам). */
export async function sumCoursePackageLessonEntitlement(
  admin: SupabaseClient,
  telegramId: number,
  courseId?: number | null,
): Promise<number> {
  const { data, error } = await admin
    .from('lesson_packages')
    .select('total_lessons, status, course_id, title')
    .eq('telegram_id', telegramId)
    .eq('product', 'course')
    .neq('status', 'cancelled');
  if (error) throw error;
  const rows = data ?? [];
  if (courseId == null) {
    return rows.reduce((sum, row) => sum + Math.max(0, row.total_lessons as number), 0);
  }

  const { data: courseRow } = await admin
    .from('courses')
    .select('slug, title')
    .eq('id', courseId)
    .maybeSingle();
  const slug = (courseRow?.slug as string | undefined)?.trim() ?? null;
  const courseTitle = (courseRow?.title as string | undefined) ?? null;
  const aliasIds = new Set(await expandCourseIdAliases(admin, courseId));
  const pkgCourseIds = [
    ...new Set(
      rows
        .map((row) => row.course_id as number | null)
        .filter((id): id is number => id != null),
    ),
  ];
  const slugByPkgCourseId = new Map<number, string>();
  if (pkgCourseIds.length > 0) {
    const { data: courseRows } = await admin
      .from('courses')
      .select('id, slug')
      .in('id', pkgCourseIds);
    for (const c of courseRows ?? []) {
      if (c.id != null && c.slug) slugByPkgCourseId.set(c.id as number, c.slug as string);
    }
  }

  return rows.reduce((sum, row) => {
    const total = Math.max(0, row.total_lessons as number);
    const pkgTitle = (row as { title?: string }).title;
    if (
      coursePackageRowMatchesCourse(
        row.course_id as number | null,
        pkgTitle,
        courseId,
        slug,
        courseTitle,
        aliasIds,
        slugByPkgCourseId,
      )
    ) {
      return sum + total;
    }
    return sum;
  }, 0);
}

/** Остаток занятий в пакетах курса (active + completed, не cancelled). */
export async function sumCoursePackageRemainingLessons(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
): Promise<{ remaining: number; total: number }> {
  const { data, error } = await admin
    .from('lesson_packages')
    .select('total_lessons, remaining_lessons, status, course_id, title')
    .eq('telegram_id', telegramId)
    .eq('product', 'course')
    .neq('status', 'cancelled');
  if (error) throw error;
  const rows = data ?? [];

  const { data: courseRow } = await admin
    .from('courses')
    .select('slug, title')
    .eq('id', courseId)
    .maybeSingle();
  const slug = (courseRow?.slug as string | undefined)?.trim() ?? null;
  const courseTitle = (courseRow?.title as string | undefined) ?? null;
  const aliasIds = new Set(await expandCourseIdAliases(admin, courseId));
  const pkgCourseIds = [
    ...new Set(
      rows
        .map((row) => row.course_id as number | null)
        .filter((id): id is number => id != null),
    ),
  ];
  const slugByPkgCourseId = new Map<number, string>();
  if (pkgCourseIds.length > 0) {
    const { data: courseRows } = await admin
      .from('courses')
      .select('id, slug')
      .in('id', pkgCourseIds);
    for (const c of courseRows ?? []) {
      if (c.id != null && c.slug) slugByPkgCourseId.set(c.id as number, c.slug as string);
    }
  }

  let remaining = 0;
  let total = 0;
  for (const row of rows) {
    const pkgTitle = (row as { title?: string }).title;
    if (
      !coursePackageRowMatchesCourse(
        row.course_id as number | null,
        pkgTitle,
        courseId,
        slug,
        courseTitle,
        aliasIds,
        slugByPkgCourseId,
      )
    ) {
      continue;
    }
    remaining += Math.max(0, row.remaining_lessons as number);
    total += Math.max(0, row.total_lessons as number);
  }
  return { remaining, total };
}

/** Есть оплаченный пакет / зачисление на конкретный курс. */
export async function studentHasCourseAccessForCourse(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
): Promise<boolean> {
  const aliasIds = await expandCourseIdAliases(admin, courseId);
  const { data: enrollment } = await admin
    .from('course_enrollments')
    .select('id')
    .eq('telegram_id', telegramId)
    .in('course_id', aliasIds)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (!enrollment) return false;
  const entitlement = await sumCoursePackageLessonEntitlement(admin, telegramId, courseId);
  return entitlement > 0;
}

/**
 * После полной блокировки и повторной оплаты: стереть access/progress,
 * сбросить жизни и блокировки, выдать пробный урок как новичку.
 */
export async function resetCourseLearningForRepurchase(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  content?: DistrictCourseContent | null,
): Promise<void> {
  const sanityIds = content
    ? flattenCourseLessons(content).map((l) => l.sanityId)
    : [];

  const { data: lessons, error: lessonError } = await admin
    .from('course_lessons')
    .select('id')
    .eq('course_id', courseId);
  if (lessonError && !isCourseAccessTableError(lessonError)) throw lessonError;
  const lessonIds = (lessons ?? []).map((l) => l.id as number);

  if (sanityIds.length > 0) {
    const { error } = await admin
      .from('course_lesson_access')
      .delete()
      .eq('telegram_id', telegramId)
      .in('sanity_lesson_id', sanityIds);
    if (error && !isCourseAccessTableError(error)) throw error;

    const { error: progressError } = await admin
      .from('course_lesson_student_progress')
      .delete()
      .eq('telegram_id', telegramId)
      .in('sanity_lesson_id', sanityIds);
    if (progressError && !String(progressError.message ?? '').includes('does not exist')) {
      throw progressError;
    }
  }

  if (lessonIds.length > 0) {
    const { error } = await admin
      .from('course_lesson_access')
      .delete()
      .eq('telegram_id', telegramId)
      .in('course_lesson_id', lessonIds);
    if (error && !isCourseAccessTableError(error)) throw error;

    const { error: progressError } = await admin
      .from('course_lesson_student_progress')
      .delete()
      .eq('telegram_id', telegramId)
      .in('course_lesson_id', lessonIds);
    if (progressError && !String(progressError.message ?? '').includes('does not exist')) {
      // sanity_id path мог уже удалить; legacy course_lesson_id — best effort
      if (!String(progressError.message ?? '').includes('course_lesson_id')) throw progressError;
    }
  }

  await resetEnrollmentStateForRepurchase(admin, telegramId, courseId);
  await grantEnrollmentTrialAccess(admin, telegramId, courseId, content);
}

/** Пробный урок после записи — первый isTrialFree из Sanity. */
export async function grantEnrollmentTrialAccess(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  content?: DistrictCourseContent | null,
): Promise<void> {
  if (content) {
    const trial = flattenCourseLessons(content).find(
      (l) => l.isTrialFree && l.publicationStatus === 'published',
    );
    if (trial) {
      await upsertSanityLessonAccess(admin, telegramId, trial.sanityId, 'enrollment');
      return;
    }
  }

  const { data: trialLesson, error: lessonError } = await admin
    .from('course_lessons')
    .select('id')
    .eq('course_id', courseId)
    .eq('is_trial_free', true)
    .order('lesson_index', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (lessonError) throw lessonError;
  if (!trialLesson?.id) return;

  const { error } = await admin.from('course_lesson_access').upsert(
    {
      telegram_id: telegramId,
      course_lesson_id: trialLesson.id,
      access_status: 'available',
      source: 'enrollment',
      package_id: null,
    },
    { onConflict: 'telegram_id,course_lesson_id' },
  );
  if (error) throw error;
}

async function upsertSanityLessonAccess(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  source: LessonAccessSource,
  packageId?: number | null,
): Promise<void> {
  const patch = {
    access_status: 'available' as const,
    source,
    package_id: packageId ?? null,
  };

  const { data: existing, error: findError } = await admin
    .from('course_lesson_access')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('sanity_lesson_id', sanityLessonId)
    .maybeSingle();
  if (findError) throw findError;

  if (existing?.id) {
    const { error } = await admin.from('course_lesson_access').update(patch).eq('id', existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await admin.from('course_lesson_access').insert({
    telegram_id: telegramId,
    sanity_lesson_id: sanityLessonId,
    course_lesson_id: null,
    ...patch,
  });
  if (error) throw error;
}

async function deductOnePackageCreditFallback(
  admin: SupabaseClient,
  telegramId: number,
  packageId: number,
): Promise<number | null> {
  const now = new Date().toISOString();
  const { data: pkg, error: selectError } = await admin
    .from('lesson_packages')
    .select('id, remaining_lessons, used_lessons')
    .eq('id', packageId)
    .eq('telegram_id', telegramId)
    .eq('product', 'course')
    .eq('status', 'active')
    .maybeSingle();
  if (selectError) throw selectError;
  if (!pkg || (pkg.remaining_lessons as number) <= 0) return null;

  const { data: updated, error: updateError } = await admin
    .from('lesson_packages')
    .update({
      remaining_lessons: (pkg.remaining_lessons as number) - 1,
      used_lessons: ((pkg.used_lessons as number) ?? 0) + 1,
      updated_at: now,
    })
    .eq('id', pkg.id)
    .gt('remaining_lessons', 0)
    .select('id')
    .maybeSingle();
  if (updateError) throw updateError;
  return updated ? (updated.id as number) : null;
}

async function consumeCoursePackageCredit(
  admin: SupabaseClient,
  telegramId: number,
  preferredPackageId?: number | null,
  courseId?: number | null,
): Promise<number | null> {
  let packageToUse = preferredPackageId ?? null;
  if (courseId != null) {
    packageToUse = await resolveActiveCoursePackageId(admin, telegramId, courseId, packageToUse);
    if (!packageToUse) return null;
  }

  try {
    const { data, error } = await admin.rpc('deduct_course_package_credit', {
      p_telegram_id: telegramId,
      p_package_id: packageToUse,
    });
    if (error) throw error;
    return data as number | null;
  } catch (rpcError) {
    console.warn('[consumeCoursePackageCredit] RPC not available, using fallback:', rpcError);

    if (packageToUse) {
      return deductOnePackageCreditFallback(admin, telegramId, packageToUse);
    }
    if (courseId != null) return null;

    const { data: pkg, error: selectError2 } = await admin
      .from('lesson_packages')
      .select('id')
      .eq('telegram_id', telegramId)
      .eq('product', 'course')
      .eq('status', 'active')
      .gt('remaining_lessons', 0)
      .order('purchased_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (selectError2) throw selectError2;
    if (!pkg?.id) return null;
    return deductOnePackageCreditFallback(admin, telegramId, pkg.id as number);
  }
}

async function loadProgressMap(
  admin: SupabaseClient,
  telegramId: number,
  sanityIds: string[],
): Promise<Map<string, CourseLessonStudentProgress>> {
  if (sanityIds.length === 0) return new Map();
  const { data, error } = await admin
    .from('course_lesson_student_progress')
    .select('*')
    .eq('telegram_id', telegramId)
    .in('sanity_lesson_id', sanityIds);
  if (error) throw error;
  return new Map(
    (data ?? []).map((row) => [row.sanity_lesson_id as string, row as CourseLessonStudentProgress]),
  );
}

export type EnsureCurrentLessonUnlockedOptions = {
  packageId?: number | null;
  /** Списать 1 занятие из пакета при выдаче package-доступа (после одобрения ДЗ / завершения вебинара). */
  consumePackageCredit?: boolean;
};

async function resolveActiveCoursePackageId(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  preferredPackageId?: number | null,
): Promise<number | null> {
  const { data, error } = await admin
    .from('lesson_packages')
    .select('id, course_id, remaining_lessons, title, purchased_at')
    .eq('telegram_id', telegramId)
    .eq('product', 'course')
    .eq('status', 'active')
    .gt('remaining_lessons', 0)
    .order('purchased_at', { ascending: true });
  if (error) throw error;
  const rows = data ?? [];

  const { data: courseRow } = await admin
    .from('courses')
    .select('slug, title')
    .eq('id', courseId)
    .maybeSingle();
  const slug = (courseRow?.slug as string | undefined)?.trim() ?? null;
  const courseTitle = (courseRow?.title as string | undefined) ?? null;
  const aliasIds = new Set(await expandCourseIdAliases(admin, courseId));
  const pkgCourseIds = [
    ...new Set(
      rows.map((row) => row.course_id as number | null).filter((id): id is number => id != null),
    ),
  ];
  const slugByPkgCourseId = new Map<number, string>();
  if (pkgCourseIds.length > 0) {
    const { data: courseRows } = await admin
      .from('courses')
      .select('id, slug')
      .in('id', pkgCourseIds);
    for (const c of courseRows ?? []) {
      if (c.id != null && c.slug) slugByPkgCourseId.set(c.id as number, c.slug as string);
    }
  }

  const matching = rows.filter((row) =>
    coursePackageRowMatchesCourse(
      row.course_id as number | null,
      (row as { title?: string }).title,
      courseId,
      slug,
      courseTitle,
      aliasIds,
      slugByPkgCourseId,
    ),
  );

  if (preferredPackageId) {
    const preferred = matching.find((row) => row.id === preferredPackageId);
    if (preferred?.id) return preferred.id as number;
  }
  return (matching[0]?.id as number | undefined) ?? null;
}

/**
 * Открывает следующее занятие по порядку, если текущее ещё не доступно.
 * Кредиты пакета списываются только при consumePackageCredit (после одобрения ДЗ / завершения платного вебинара).
 * Возвращает 1 если открыли новый урок, 0 если уже был / нет кредита / курс пройден.
 */
export async function ensureCurrentLessonUnlocked(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  content: DistrictCourseContent | null | undefined,
  options?: EnsureCurrentLessonUnlockedOptions | null,
): Promise<number> {
  const packageId = options?.packageId ?? null;
  const mayConsume = options?.consumePackageCredit ?? false;
  if (!content) return 0;

  const lives = await getEnrollmentLives(admin, telegramId, courseId);
  if (lives?.fully_blocked) return 0;
  if (lives?.access_blocked) return 0;

  const { buildPublishedLessonSequence } = await import('./active-module');
  const published = buildPublishedLessonSequence(content);
  if (published.length === 0) return 0;

  const { data: enrollment } = await admin
    .from('course_enrollments')
    .select('purchase_scenario, start_lesson_id, start_module_id')
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .maybeSingle();

  const scenario = enrollment?.purchase_scenario as 'start_from_beginning' | 'join_current' | null;
  const startLessonId = enrollment?.start_lesson_id as number | null;

  if (scenario === 'join_current') {
    if (startLessonId) {
      await grantArchiveAccessBeforeStart(admin, telegramId, courseId, content, startLessonId);
    } else {
      const { resolveEnrollmentStartLessonSanityId } = await import('./course-enrollment-start');
      const startSanityId = await resolveEnrollmentStartLessonSanityId(
        admin,
        courseId,
        content,
        enrollment,
      );
      if (startSanityId) {
        await grantArchiveAccessBeforeSanityId(admin, telegramId, content, startSanityId);
      }
    }
  }

  const sanityIds = published.map((l) => l.sanityId);
  const [{ data: accessRows, error: accessError }, progressMap] = await Promise.all([
    admin
      .from('course_lesson_access')
      .select('sanity_lesson_id, access_status')
      .eq('telegram_id', telegramId)
      .in('sanity_lesson_id', sanityIds),
    loadProgressMap(admin, telegramId, sanityIds),
  ]);
  if (accessError) throw accessError;

  const accessMap = new Map(
    (accessRows ?? []).map((r) => [r.sanity_lesson_id as string, r.access_status as string]),
  );

  let gateStartIndex = 0;
  if (scenario === 'join_current') {
    const { loadJoinCurrentGateContext } = await import('./course-enrollment-start');
    const joinGate = await loadJoinCurrentGateContext(admin, telegramId, courseId, content);
    if (joinGate?.startValid) {
      gateStartIndex = joinGate.gateStartIndex;
    }
  }

  const hasCourseProduct = await studentHasCourseAccessForCourse(admin, telegramId, courseId);

  const current = published.find((lesson, index) => {
    if (index < gateStartIndex) return false;
    if (
      !previousCourseLessonsCleared(published, index, progressMap, {
        gateStartIndex,
        hasCourseProduct,
      })
    ) {
      return false;
    }
    return !isCourseLessonCleared(lesson, progressMap.get(lesson.sanityId), {
      hasCourseProduct,
    });
  });
  if (!current) return 0;

  const status = accessMap.get(current.sanityId);
  if (status === 'available' || status === 'blocked_lives') return 0;

  // Пробное — enrollment, без списания remaining_lessons
  if (current.isTrialFree) {
    await upsertSanityLessonAccess(admin, telegramId, current.sanityId, 'enrollment');
    return 1;
  }

  if (!mayConsume) return 0;

  // Уже был доступ (legacy) — не списываем кредит повторно
  if (status === 'revoked') {
    const linked = await resolveActiveCoursePackageId(admin, telegramId, courseId, packageId);
    await upsertSanityLessonAccess(admin, telegramId, current.sanityId, 'package', linked);
    return 1;
  }

  const linkedPackageId = await consumeCoursePackageCredit(admin, telegramId, packageId, courseId);
  if (!linkedPackageId) return 0;

  const { data: existingGrant } = await admin
    .from('package_lesson_grants')
    .select('package_id')
    .eq('package_id', linkedPackageId)
    .eq('sanity_lesson_id', current.sanityId)
    .maybeSingle();
  if (!existingGrant) {
    const { error: grantError } = await admin.from('package_lesson_grants').insert({
      package_id: linkedPackageId,
      sanity_lesson_id: current.sanityId,
      course_lesson_id: null,
    });
    if (grantError) throw grantError;
  }

  await upsertSanityLessonAccess(admin, telegramId, current.sanityId, 'package', linkedPackageId);
  return 1;
}

/**
 * Выдаёт свободный доступ к урокам до стартового (для join_current).
 * source=enrollment, без списания remaining_lessons и без package_lesson_grants.
 */
export async function grantArchiveAccessBeforeSanityId(
  admin: SupabaseClient,
  telegramId: number,
  content: DistrictCourseContent,
  startSanityId: string,
): Promise<void> {
  const { buildPublishedLessonSequence } = await import('./active-module');
  const allLessons = buildPublishedLessonSequence(content);
  const startIndex = allLessons.findIndex((l) => l.sanityId === startSanityId);
  if (startIndex <= 0) return;

  const archiveSanityIds = allLessons.slice(0, startIndex).map((l) => l.sanityId);
  if (archiveSanityIds.length === 0) return;

  const now = new Date().toISOString();
  const inserts = archiveSanityIds.map((sanityId) => ({
    telegram_id: telegramId,
    sanity_lesson_id: sanityId,
    course_lesson_id: null,
    access_status: 'available' as const,
    source: 'enrollment' as const,
    package_id: null,
    granted_at: now,
  }));

  const { error } = await admin
    .from('course_lesson_access')
    .upsert(inserts, { onConflict: 'telegram_id,sanity_lesson_id' });

  if (error) {
    for (const sanityId of archiveSanityIds) {
      try {
        await upsertSanityLessonAccess(admin, telegramId, sanityId, 'enrollment');
      } catch (err) {
        console.error('[grantArchiveAccessBeforeSanityId] Failed:', sanityId, err);
      }
    }
  }
}

export async function grantArchiveAccessBeforeStart(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  content: DistrictCourseContent,
  startLessonId: number,
): Promise<void> {
  const { data: startLessonRow } = await admin
    .from('course_lessons')
    .select('sanity_lesson_id')
    .eq('id', startLessonId)
    .maybeSingle();

  if (!startLessonRow?.sanity_lesson_id) return;

  await grantArchiveAccessBeforeSanityId(
    admin,
    telegramId,
    content,
    startLessonRow.sanity_lesson_id as string,
  );
}

/** После оплаты join_current: архив + первое полноценное занятие (идемпотентно). */
export async function syncJoinCurrentEnrollmentAccess(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  content: DistrictCourseContent | null | undefined,
  packageId?: number | null,
): Promise<void> {
  if (!content) return;

  const { data: enrollment } = await admin
    .from('course_enrollments')
    .select('purchase_scenario, start_lesson_id')
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .maybeSingle();

  if (enrollment?.purchase_scenario !== 'join_current') return;

  let startLessonId = enrollment.start_lesson_id as number | null;
  if (!startLessonId) {
    const { resolveJoinCurrentStartIds } = await import('./active-module');
    const { resolveEnrollmentStartLessonSanityId } = await import('./course-enrollment-start');
    const joinStart = await resolveJoinCurrentStartIds(admin, courseId, content);
    if (joinStart.startLessonId || joinStart.startModuleId) {
      await admin
        .from('course_enrollments')
        .update({
          start_module_id: joinStart.startModuleId,
          start_lesson_id: joinStart.startLessonId,
          updated_at: new Date().toISOString(),
        })
        .eq('telegram_id', telegramId)
        .eq('course_id', courseId);
      startLessonId = joinStart.startLessonId;
    } else {
      const startSanityId = await resolveEnrollmentStartLessonSanityId(
        admin,
        courseId,
        content,
        enrollment,
      );
      if (startSanityId) {
        await grantArchiveAccessBeforeSanityId(admin, telegramId, content, startSanityId);
      }
    }
  }

  if (startLessonId) {
    await grantArchiveAccessBeforeStart(admin, telegramId, courseId, content, startLessonId);
  }

}

/** После одобрения ДЗ / прохождения урока без ДЗ — открыть следующее. */
export async function unlockNextCourseLessonAfterCleared(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  content?: DistrictCourseContent | null,
): Promise<number> {
  return ensureCurrentLessonUnlocked(admin, telegramId, courseId, content ?? null, {
    consumePackageCredit: true,
  });
}

/** Полный доступ ко всем опубликованным — больше не открывает пачкой; только текущее. */
export async function grantAllPublishedCourseLessons(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  packageId: number,
  content?: DistrictCourseContent | null,
): Promise<number> {
  return grantPackageLessonAccess(
    admin,
    telegramId,
    courseId,
    packageId,
    content ? flattenCourseLessons(content).filter((l) => l.publicationStatus === 'published').length : 1,
    content,
  );
}

/**
 * После покупки / продления: пробное (если ещё нет) + одно «ожидающее» платное занятие.
 * Списывает 1 кредит только если предыдущие закрыты, а следующее ещё без access
 * (например ДЗ одобрили при remaining=0 — после пополнения пакета).
 */
export async function syncCourseAccessAfterPackagePurchase(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  packageId: number,
  content?: DistrictCourseContent | null,
): Promise<number> {
  if (content) {
    await grantEnrollmentTrialAccess(admin, telegramId, courseId, content);
    const { ensureTrialHomeworkDeadlineIfEligible } = await import('./homework-deadline');
    await ensureTrialHomeworkDeadlineIfEligible(admin, telegramId, content, courseId);
    return ensureCurrentLessonUnlocked(admin, telegramId, courseId, content, {
      packageId,
      consumePackageCredit: false,
    });
  }
  return grantPackageLessonAccess(admin, telegramId, courseId, packageId, 1, null);
}

/**
 * Покупка N занятий: кредиты уже в lesson_packages.remaining_lessons.
 * Открывает только текущее (если ещё не открыто) — не все N сразу.
 */
export async function grantPackageLessonAccess(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  packageId: number,
  _lessonCount: number,
  content?: DistrictCourseContent | null,
): Promise<number> {
  if (content) {
    return syncCourseAccessAfterPackagePurchase(admin, telegramId, courseId, packageId, content);
  }

  // Legacy Supabase-каталог: открыть один следующий урок
  const { data: allLessons, error: allError } = await admin
    .from('course_lessons')
    .select('id, lesson_index')
    .eq('course_id', courseId)
    .order('lesson_index', { ascending: true });
  if (allError) throw allError;

  const { data: granted, error: grantedError } = await admin
    .from('course_lesson_access')
    .select('course_lesson_id, access_status')
    .eq('telegram_id', telegramId);
  if (grantedError) throw grantedError;

  const availableIds = new Set(
    (granted ?? [])
      .filter((r) => r.access_status === 'available' || r.access_status === 'blocked_lives')
      .map((r) => r.course_lesson_id as number),
  );

  const { data: completed } = await admin
    .from('course_lesson_student_progress')
    .select('course_lesson_id')
    .eq('telegram_id', telegramId)
    .not('completed_at', 'is', null);
  const completedIds = new Set(
    (completed ?? []).map((r) => r.course_lesson_id as number).filter((id) => id != null),
  );

  const next = (allLessons ?? []).find(
    (l) => !completedIds.has(l.id as number) && !availableIds.has(l.id as number),
  );
  if (!next) return 0;

  const consumedPackageId = await consumeCoursePackageCredit(admin, telegramId, packageId, courseId);
  if (!consumedPackageId) return 0;

  const { error: accessError } = await admin.from('course_lesson_access').upsert(
    {
      telegram_id: telegramId,
      course_lesson_id: next.id,
      access_status: 'available',
      source: 'package',
      package_id: consumedPackageId,
    },
    { onConflict: 'telegram_id,course_lesson_id' },
  );
  if (accessError) throw accessError;

  const { error: grantError } = await admin.from('package_lesson_grants').upsert(
    { package_id: consumedPackageId, course_lesson_id: next.id },
    { onConflict: 'package_id,course_lesson_id' },
  );
  if (grantError) throw grantError;
  return 1;
}

/**
 * Раньше переводил available → blocked_lives (резал текущее ДЗ).
 * Состояние A: заморозка только через access_blocked + запрет unlock новых уроков.
 * Функция оставлена no-op для совместимости вызовов.
 */
export async function blockLessonsForZeroLives(
  _admin: SupabaseClient,
  _telegramId: number,
  _courseId: number,
  _content?: DistrictCourseContent | null,
): Promise<void> {
  /* no-op: State A */
}

/** Разблокирует уроки после восстановления жизней. */
export async function unblockLessonsAfterLivesRestore(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  content?: DistrictCourseContent | null,
): Promise<void> {
  if (content) {
    const sanityIds = flattenCourseLessons(content).map((l) => l.sanityId);
    if (sanityIds.length === 0) return;

    const { error } = await admin
      .from('course_lesson_access')
      .update({ access_status: 'available' })
      .eq('telegram_id', telegramId)
      .eq('access_status', 'blocked_lives')
      .in('sanity_lesson_id', sanityIds);
    if (error) throw error;
    return;
  }

  const { data: lessonIds } = await admin.from('course_lessons').select('id').eq('course_id', courseId);
  const ids = (lessonIds ?? []).map((l) => l.id as number);
  if (ids.length === 0) return;

  const { error } = await admin
    .from('course_lesson_access')
    .update({ access_status: 'available' })
    .eq('telegram_id', telegramId)
    .eq('access_status', 'blocked_lives')
    .in('course_lesson_id', ids);
  if (error) throw error;
}

export async function getStudentLessonAccess(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  content?: DistrictCourseContent | null,
): Promise<CourseLessonAccessRow[]> {
  if (content) {
    const sanityIds = flattenCourseLessons(content).map((l) => l.sanityId);
    if (sanityIds.length === 0) return [];

    const { data, error } = await admin
      .from('course_lesson_access')
      .select(
        'id, telegram_id, course_lesson_id, sanity_lesson_id, access_status, source, package_id, granted_at',
      )
      .eq('telegram_id', telegramId)
      .in('sanity_lesson_id', sanityIds);
    if (error) throw error;
    return (data ?? []) as CourseLessonAccessRow[];
  }

  const { data: lessons, error: lessonError } = await admin
    .from('course_lessons')
    .select('id')
    .eq('course_id', courseId);
  if (lessonError) throw lessonError;
  const lessonIds = (lessons ?? []).map((l) => l.id as number);
  if (lessonIds.length === 0) return [];

  const { data, error } = await admin
    .from('course_lesson_access')
    .select(
      'id, telegram_id, course_lesson_id, sanity_lesson_id, access_status, source, package_id, granted_at',
    )
    .eq('telegram_id', telegramId)
    .in('course_lesson_id', lessonIds);
  if (error) throw error;
  return (data ?? []) as CourseLessonAccessRow[];
}

/** Можно ли смотреть занятие (access + предыдущие закрыты). */
export async function canStudentWatchSanityLesson(
  admin: SupabaseClient,
  telegramId: number,
  sanityLessonId: string,
  content: DistrictCourseContent,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { resolveCourseIdForContent } = await import('@/lib/bot/education/course-record');
  const courseId = await resolveCourseIdForContent(admin, content);

  if (courseId) {
    const lives = await getEnrollmentLives(admin, telegramId, courseId);
    if (lives?.fully_blocked) {
      return {
        ok: false,
        reason: 'Курс полностью заблокирован администратором. Материалы недоступны.',
      };
    }
  }

  const { buildPublishedLessonSequence } = await import('./active-module');
  const published = buildPublishedLessonSequence(content);
  const index = published.findIndex((l) => l.sanityId === sanityLessonId);
  if (index < 0) return { ok: false, reason: 'Занятие не найдено в программе.' };

  const lesson = published[index]!;
  const sanityIds = published.map((l) => l.sanityId);
  const [{ data: accessRows, error }, progressMap] = await Promise.all([
    admin
      .from('course_lesson_access')
      .select('sanity_lesson_id, access_status')
      .eq('telegram_id', telegramId)
      .in('sanity_lesson_id', sanityIds),
    loadProgressMap(admin, telegramId, sanityIds),
  ]);
  if (error) throw error;

  const accessMap = new Map(
    (accessRows ?? []).map((r) => [r.sanity_lesson_id as string, r.access_status as string]),
  );
  let status = accessMap.get(lesson.sanityId) ?? null;

  const hasCourseProduct = await studentHasCourseProductAccess(admin, telegramId);

  const { loadJoinCurrentGateContext, isJoinArchiveSanityId } = await import(
    './course-enrollment-start'
  );
  const joinGate =
    courseId != null
      ? await loadJoinCurrentGateContext(admin, telegramId, courseId, content)
      : null;
  const isArchive = isJoinArchiveSanityId(joinGate, sanityLessonId);

  if (
    !isArchive &&
    !previousCourseLessonsCleared(published, index, progressMap, {
      hasCourseProduct,
      gateStartIndex: joinGate?.gateStartIndex,
    })
  ) {
    return {
      ok: false,
      reason: hasCourseProduct
        ? 'Сначала выполните ДЗ по предыдущему занятию и дождитесь одобрения куратора.'
        : 'Сначала завершите пробное занятие или купите пакет курса.',
    };
  }

  if (isArchive) {
    if (status === 'available' || status === 'blocked_lives') return { ok: true };
    if (hasCourseProduct) {
      await upsertSanityLessonAccess(admin, telegramId, lesson.sanityId, 'enrollment');
      return { ok: true };
    }
    return { ok: false, reason: 'Архивное занятие доступно после оплаты курса.' };
  }

  // Уже открытое занятие (в т.ч. legacy blocked_lives) — доступно при обычной заморозке.
  if (status === 'available' || status === 'blocked_lives') return { ok: true };

  if (status === 'revoked') {
    return { ok: false, reason: 'Доступ к занятию отозван.' };
  }

  // Пробное без строки access
  if (lesson.isTrialFree) {
    const { data: enrollment } = await admin
      .from('course_enrollments')
      .select('id')
      .eq('telegram_id', telegramId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (enrollment) {
      const lives = courseId ? await getEnrollmentLives(admin, telegramId, courseId) : null;
      if (lives?.access_blocked) {
        return {
          ok: false,
          reason: 'Доступ к новым занятиям приостановлен: закончились жизни. Свяжитесь с куратором.',
        };
      }
      await upsertSanityLessonAccess(admin, telegramId, lesson.sanityId, 'enrollment');
      return { ok: true };
    }
  }

  if (courseId) {
    const lives = await getEnrollmentLives(admin, telegramId, courseId);
    if (lives?.access_blocked) {
      return {
        ok: false,
        reason: 'Доступ к новым занятиям приостановлен: закончились жизни. Свяжитесь с куратором.',
      };
    }
  }

  return {
    ok: false,
    reason:
      'Занятие ещё не открыто. Нужна оплата пакета занятий или завершение предыдущих (просмотр + одобренное ДЗ).',
  };
}
