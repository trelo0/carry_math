import type { SupabaseClient } from '@supabase/supabase-js';
import type { CourseLessonContent, DistrictCourseContent } from '@/lib/studio/courseContent';
import { flattenCourseLessons } from '@/lib/studio/courseContent';
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
 * Только если в БД **нет ни одной** строки lesson_packages (product=course) — например админ удалил пакеты.
 * Нулевой remaining / status=completed **не** триггерит сброс: прогресс и доступ к пройденным занятиям сохраняются.
 */
export async function resetCourseWhenNoPaidPackages(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  content?: DistrictCourseContent | null,
): Promise<boolean> {
  const { count, error: countError } = await admin
    .from('lesson_packages')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId)
    .eq('product', 'course');
  if (countError) throw countError;
  if ((count ?? 0) > 0) return false;

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
): Promise<number> {
  const { data, error } = await admin
    .from('lesson_packages')
    .select('total_lessons, status')
    .eq('telegram_id', telegramId)
    .eq('product', 'course')
    .neq('status', 'cancelled');
  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + Math.max(0, row.total_lessons as number), 0);
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

async function consumeCoursePackageCredit(
  admin: SupabaseClient,
  telegramId: number,
  preferredPackageId?: number | null,
): Promise<number | null> {
  // Сначала пробуем использовать SQL-функцию для атомарности
  try {
    const { data, error } = await admin.rpc('deduct_course_package_credit', {
      p_telegram_id: telegramId,
      p_package_id: preferredPackageId ?? null,
    });
    if (error) throw error;
    return data as number | null;
  } catch (rpcError) {
    // Fallback на обычный метод, если функция ещё не создана
    console.warn('[consumeCoursePackageCredit] RPC not available, using fallback:', rpcError);
    const now = new Date().toISOString();

    if (preferredPackageId) {
      const { data: pkg, error: selectError } = await admin
        .from('lesson_packages')
        .select('id, remaining_lessons, used_lessons')
        .eq('id', preferredPackageId)
        .eq('telegram_id', telegramId)
        .eq('product', 'course')
        .eq('status', 'active')
        .maybeSingle();
      if (selectError) throw selectError;
      if (pkg && (pkg.remaining_lessons as number) > 0) {
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
        if (updated) return updated.id as number;
      }
    }

    const { data: pkg, error: selectError2 } = await admin
      .from('lesson_packages')
      .select('id, remaining_lessons, used_lessons')
      .eq('telegram_id', telegramId)
      .eq('product', 'course')
      .eq('status', 'active')
      .gt('remaining_lessons', 0)
      .order('purchased_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (selectError2) throw selectError2;
    if (!pkg) return null;

    const { data: updated, error: updError } = await admin
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
    if (updError) throw updError;
    if (!updated) return null;
    return updated.id as number;
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

/**
 * Открывает следующее занятие по порядку, если текущее ещё не доступно.
 * Кредиты пакета (remaining_lessons) списываются только при новом package-доступе.
 * Возвращает 1 если открыли новый урок, 0 если уже был / нет кредита / курс пройден.
 */
export async function ensureCurrentLessonUnlocked(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  content: DistrictCourseContent | null | undefined,
  packageId?: number | null,
): Promise<number> {
  if (!content) return 0;

  const lives = await getEnrollmentLives(admin, telegramId, courseId);
  if (lives?.fully_blocked) return 0;
  if (lives?.access_blocked) return 0;

  const published = flattenCourseLessons(content).filter((l) => l.publicationStatus === 'published');
  if (published.length === 0) return 0;

  // Проверяем сценарий в course_enrollments
  const { data: enrollment } = await admin
    .from('course_enrollments')
    .select('purchase_scenario, start_lesson_id')
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .maybeSingle();

  const scenario = enrollment?.purchase_scenario as 'start_from_beginning' | 'join_current' | null;
  const startLessonId = enrollment?.start_lesson_id as number | null;

  // Для join_current: выдаём свободный доступ к урокам до стартового
  if (scenario === 'join_current' && startLessonId) {
    await grantArchiveAccessBeforeStart(admin, telegramId, courseId, content, startLessonId);
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

  // Для join_current: начинаем со стартового урока, игнорируя предыдущие
  let startIndex = 0;
  if (scenario === 'join_current' && startLessonId) {
    // Находим sanity_id стартового урока в Supabase
    const { data: startLessonRow } = await admin
      .from('course_lessons')
      .select('sanity_lesson_id')
      .eq('id', startLessonId)
      .maybeSingle();
    
    if (startLessonRow?.sanity_lesson_id) {
      const startSanityId = startLessonRow.sanity_lesson_id as string;
      const startLessonIndex = published.findIndex((l) => l.sanityId === startSanityId);
      if (startLessonIndex >= 0) {
        startIndex = startLessonIndex;
      }
    }
  }

  const gateStartIndex =
    scenario === 'join_current' && startIndex > 0 ? startIndex : 0;

  const current = published.find((lesson, index) => {
    if (index < startIndex) return false; // Пропускаем уроки до стартового
    if (
      !previousCourseLessonsCleared(published, index, progressMap, {
        gateStartIndex,
      })
    ) {
      return false;
    }
    return !isCourseLessonCleared(lesson, progressMap.get(lesson.sanityId));
  });
  if (!current) return 0;

  const status = accessMap.get(current.sanityId);
  if (status === 'available' || status === 'blocked_lives') return 0;

  // Пробное — enrollment, без списания remaining_lessons
  if (current.isTrialFree) {
    await upsertSanityLessonAccess(admin, telegramId, current.sanityId, 'enrollment');
    return 1;
  }

  // Уже был доступ (legacy) — не списываем кредит повторно
  if (status === 'revoked') {
    await upsertSanityLessonAccess(admin, telegramId, current.sanityId, 'package', packageId);
    return 1;
  }

  const consumedPackageId = await consumeCoursePackageCredit(admin, telegramId, packageId);
  if (!consumedPackageId) {
    // Нет оплаты / кредитов — следующее занятие остаётся закрытым
    return 0;
  }

  await upsertSanityLessonAccess(admin, telegramId, current.sanityId, 'package', consumedPackageId);

  const { data: existingGrant } = await admin
    .from('package_lesson_grants')
    .select('package_id')
    .eq('package_id', consumedPackageId)
    .eq('sanity_lesson_id', current.sanityId)
    .maybeSingle();
  if (!existingGrant) {
    const { error: grantError } = await admin.from('package_lesson_grants').insert({
      package_id: consumedPackageId,
      sanity_lesson_id: current.sanityId,
      course_lesson_id: null,
    });
    if (grantError) throw grantError;
  }
  return 1;
}

/**
 * Выдаёт свободный доступ к урокам до стартового (для join_current).
 * Эти уроки доступны для просмотра без требования ДЗ и без запуска таймера.
 */
export async function grantArchiveAccessBeforeStart(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  content: DistrictCourseContent,
  startLessonId: number,
): Promise<void> {
  const allLessons = flattenCourseLessons(content).filter((l) => l.publicationStatus === 'published');
  
  // Находим sanity_id стартового урока
  const { data: startLessonRow } = await admin
    .from('course_lessons')
    .select('sanity_lesson_id')
    .eq('id', startLessonId)
    .maybeSingle();
  
  if (!startLessonRow?.sanity_lesson_id) return;
  
  const startSanityId = startLessonRow.sanity_lesson_id as string;
  const startIndex = allLessons.findIndex((l) => l.sanityId === startSanityId);
  
  if (startIndex <= 0) return; // Нечего выдавать
  
  // Выдаём доступ ко всем урокам до стартового
  const archiveLessons = allLessons.slice(0, startIndex);
  const archiveSanityIds = archiveLessons.map((l) => l.sanityId);
  
  if (archiveSanityIds.length === 0) return;
  
  // Пакетная вставка для эффективности
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
    // Fallback к поочерёдной вставке при ошибке
    for (const sanityId of archiveSanityIds) {
      try {
        await upsertSanityLessonAccess(admin, telegramId, sanityId, 'enrollment');
      } catch (err) {
        console.error('[grantArchiveAccessBeforeStart] Failed to grant access to lesson:', sanityId, err);
      }
    }
  }
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

  const startLessonId = enrollment.start_lesson_id as number | null;
  if (startLessonId) {
    await grantArchiveAccessBeforeStart(admin, telegramId, courseId, content, startLessonId);
  }

  await ensureCurrentLessonUnlocked(admin, telegramId, courseId, content, packageId ?? null);
}

/** После одобрения ДЗ / прохождения урока без ДЗ — открыть следующее. */
export async function unlockNextCourseLessonAfterCleared(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  content?: DistrictCourseContent | null,
): Promise<number> {
  return ensureCurrentLessonUnlocked(admin, telegramId, courseId, content ?? null, null);
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
    return ensureCurrentLessonUnlocked(admin, telegramId, courseId, content, packageId);
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

  const consumedPackageId = await consumeCoursePackageCredit(admin, telegramId, packageId);
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

  const published = flattenCourseLessons(content).filter((l) => l.publicationStatus === 'published');
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
    try {
      await ensureCurrentLessonUnlocked(admin, telegramId, courseId, content);
      const { data: refreshed } = await admin
        .from('course_lesson_access')
        .select('access_status')
        .eq('telegram_id', telegramId)
        .eq('sanity_lesson_id', lesson.sanityId)
        .maybeSingle();
      status = (refreshed?.access_status as string | null) ?? null;
      if (status === 'available' || status === 'blocked_lives') return { ok: true };
    } catch (unlockError) {
      console.error('[canStudentWatch] ensure unlock failed:', unlockError);
    }
  }

  return {
    ok: false,
    reason:
      'Занятие ещё не открыто. Нужна оплата пакета занятий или завершение предыдущих (просмотр + одобренное ДЗ).',
  };
}
