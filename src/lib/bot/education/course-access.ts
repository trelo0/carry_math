import type { SupabaseClient } from '@supabase/supabase-js';
import type { DistrictCourseContent } from '@/lib/studio/courseContent';
import { flattenCourseLessons } from '@/lib/studio/courseContent';

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
  const { error } = await admin.from('course_lesson_access').upsert(
    {
      telegram_id: telegramId,
      sanity_lesson_id: sanityLessonId,
      access_status: 'available',
      source,
      package_id: packageId ?? null,
    },
    { onConflict: 'telegram_id,sanity_lesson_id' },
  );
  if (error) throw error;
}

/** Полный доступ ко всем опубликованным урокам курса (покупка курса). */
export async function grantAllPublishedCourseLessons(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  packageId: number,
  content?: DistrictCourseContent | null,
): Promise<number> {
  if (content) {
    const published = flattenCourseLessons(content).filter((l) => l.publicationStatus === 'published');
    if (published.length === 0) return 0;
    return grantPackageLessonAccess(admin, telegramId, courseId, packageId, published.length, content);
  }

  const { count, error } = await admin
    .from('course_lessons')
    .select('id', { count: 'exact', head: true })
    .eq('course_id', courseId);
  if (error) throw error;
  if (!count) return 0;
  return grantPackageLessonAccess(admin, telegramId, courseId, packageId, count);
}

/** Открывает следующие N уроков из Sanity-каталога. */
export async function grantPackageLessonAccess(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  packageId: number,
  lessonCount: number,
  content?: DistrictCourseContent | null,
): Promise<number> {
  if (content) {
    const published = flattenCourseLessons(content).filter((l) => l.publicationStatus === 'published');
    const { data: granted, error: grantedError } = await admin
      .from('course_lesson_access')
      .select('sanity_lesson_id')
      .eq('telegram_id', telegramId)
      .not('sanity_lesson_id', 'is', null);
    if (grantedError) throw grantedError;

    const grantedIds = new Set((granted ?? []).map((r) => r.sanity_lesson_id as string));
    const toGrant = published.filter((l) => !grantedIds.has(l.sanityId)).slice(0, lessonCount);
    if (toGrant.length === 0) return 0;

    for (const lesson of toGrant) {
      await upsertSanityLessonAccess(admin, telegramId, lesson.sanityId, 'package', packageId);
    }

    const grantRows = toGrant.map((l) => ({
      package_id: packageId,
      sanity_lesson_id: l.sanityId,
    }));
    const { error: grantError } = await admin
      .from('package_lesson_grants')
      .upsert(grantRows, { onConflict: 'package_id,sanity_lesson_id' });
    if (grantError) throw grantError;

    return toGrant.length;
  }

  const { data: allLessons, error: allError } = await admin
    .from('course_lessons')
    .select('id, lesson_index')
    .eq('course_id', courseId)
    .order('lesson_index', { ascending: true });
  if (allError) throw allError;

  const { data: granted, error: grantedError } = await admin
    .from('course_lesson_access')
    .select('course_lesson_id')
    .eq('telegram_id', telegramId);
  if (grantedError) throw grantedError;

  const grantedIds = new Set((granted ?? []).map((r) => r.course_lesson_id as number));
  const toGrant = (allLessons ?? [])
    .filter((l) => !grantedIds.has(l.id as number))
    .slice(0, lessonCount);

  if (toGrant.length === 0) return 0;

  const accessRows = toGrant.map((l) => ({
    telegram_id: telegramId,
    course_lesson_id: l.id,
    access_status: 'available' as const,
    source: 'package' as const,
    package_id: packageId,
  }));

  const { error: accessError } = await admin
    .from('course_lesson_access')
    .upsert(accessRows, { onConflict: 'telegram_id,course_lesson_id' });
  if (accessError) throw accessError;

  const grantRows = toGrant.map((l) => ({
    package_id: packageId,
    course_lesson_id: l.id,
  }));
  const { error: grantError } = await admin
    .from('package_lesson_grants')
    .upsert(grantRows, { onConflict: 'package_id,course_lesson_id' });
  if (grantError) throw grantError;

  return toGrant.length;
}

/** Блокирует доступные, но не завершённые уроки при 0 жизней. */
export async function blockLessonsForZeroLives(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  content?: DistrictCourseContent | null,
): Promise<void> {
  const { data: completed, error: progError } = await admin
    .from('course_lesson_student_progress')
    .select('course_lesson_id, sanity_lesson_id, completed_at')
    .eq('telegram_id', telegramId)
    .not('completed_at', 'is', null);
  if (progError) throw progError;

  const completedLegacyIds = (completed ?? [])
    .map((r) => r.course_lesson_id as number | null)
    .filter((id): id is number => id != null);
  const completedSanityIds = new Set(
    (completed ?? []).map((r) => r.sanity_lesson_id as string | null).filter(Boolean) as string[],
  );

  if (content) {
    const sanityIds = flattenCourseLessons(content)
      .filter((l) => !completedSanityIds.has(l.sanityId))
      .map((l) => l.sanityId);
    if (sanityIds.length === 0) return;

    const { error } = await admin
      .from('course_lesson_access')
      .update({ access_status: 'blocked_lives' })
      .eq('telegram_id', telegramId)
      .eq('access_status', 'available')
      .in('sanity_lesson_id', sanityIds);
    if (error) throw error;
    return;
  }

  const { data: lessonIds } = await admin.from('course_lessons').select('id').eq('course_id', courseId);
  const ids = (lessonIds ?? []).map((l) => l.id as number);
  if (ids.length === 0) return;

  const { error } = await admin
    .from('course_lesson_access')
    .update({ access_status: 'blocked_lives' })
    .eq('telegram_id', telegramId)
    .eq('access_status', 'available')
    .in('course_lesson_id', ids.filter((id) => !completedLegacyIds.includes(id)));
  if (error) throw error;
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
      .select('id, telegram_id, course_lesson_id, sanity_lesson_id, access_status, source, package_id, granted_at')
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
    .select('id, telegram_id, course_lesson_id, sanity_lesson_id, access_status, source, package_id, granted_at')
    .eq('telegram_id', telegramId)
    .in('course_lesson_id', lessonIds);
  if (error) throw error;
  return (data ?? []) as CourseLessonAccessRow[];
}
