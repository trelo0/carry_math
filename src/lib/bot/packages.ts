import type { SupabaseClient } from '@supabase/supabase-js';
import { type AccessProduct, grantAccess, isAccessTableError } from './accesses';
import {
  grantPackageLessonAccess,
  isCourseAccessTableError,
  resetCourseLearningForRepurchase,
} from './education/course-access';
import { resolveCourseIdForContent } from './education/course-record';
import { enrollStudent, getActiveCourses } from './education/courses';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';
import { assignTeacher } from './education/assignments';
import { resolveTeacherTelegramId } from './teacher-mapping';
import { getEnrollmentLives, initEnrollmentLives, isLivesTableError } from './education/lives';

export function isPackageTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return (
    message.includes('lesson_packages') ||
    message.includes('payments') ||
    message.includes('does not exist') ||
    message.includes('Could not find')
  );
}

export type LessonPackageRow = {
  id: number;
  telegram_id: number;
  product: AccessProduct;
  title: string;
  total_lessons: number;
  remaining_lessons: number;
  status: 'active' | 'completed' | 'cancelled';
  purchased_at: string;
  expires_at: string | null;
};

/** Создаёт или пополняет пакет занятий после оплаты. */
export async function grantLessonPackage(
  admin: SupabaseClient,
  telegramId: number,
  product: AccessProduct,
  options: {
    title: string;
    lessons: number;
    expiresAt?: string | null;
    purchaseRequestId?: string;
    courseId?: number | null;
  },
): Promise<LessonPackageRow> {
  const now = new Date().toISOString();
  
  // Если указан purchase_request_id — создаём отдельный пакет (не accumulate)
  if (options.purchaseRequestId) {
    const { data, error } = await admin
      .from('lesson_packages')
      .insert({
        telegram_id: telegramId,
        product,
        title: options.title,
        total_lessons: options.lessons,
        remaining_lessons: options.lessons,
        used_lessons: 0,
        status: 'active',
        expires_at: options.expiresAt ?? null,
        purchase_request_id: options.purchaseRequestId,
        course_id: product === 'course' ? (options.courseId ?? null) : null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as LessonPackageRow;
  }
  
  // Legacy: accumulate в один активный пакет (если их несколько — сливаем в последний).
  const existing =
    product === 'course' && options.courseId != null
      ? await consolidateActiveCoursePackages(admin, telegramId, options.courseId)
      : await pickLatestActivePackage(admin, telegramId, product);

  if (existing) {
    const { data, error } = await admin
      .from('lesson_packages')
      .update({
        title: options.title,
        total_lessons: existing.total_lessons + options.lessons,
        remaining_lessons: existing.remaining_lessons + options.lessons,
        status: 'active',
        expires_at: options.expiresAt ?? null,
        updated_at: now,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as LessonPackageRow;
  }

  const { data, error } = await admin
    .from('lesson_packages')
    .insert({
      telegram_id: telegramId,
      product,
      title: options.title,
      total_lessons: options.lessons,
      remaining_lessons: options.lessons,
      used_lessons: 0,
      status: 'active',
      expires_at: options.expiresAt ?? null,
      purchase_request_id: null,
      course_id: product === 'course' ? (options.courseId ?? null) : null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as LessonPackageRow;
}

type ActivePackageRow = {
  id: number;
  total_lessons: number;
  remaining_lessons: number;
  title?: string;
};

/** Один активный пакет без maybeSingle (PostgREST падает, если строк > 1). */
async function pickLatestActivePackage(
  admin: SupabaseClient,
  telegramId: number,
  product: AccessProduct,
  courseId?: number | null,
): Promise<ActivePackageRow | null> {
  let q = admin
    .from('lesson_packages')
    .select('id, total_lessons, remaining_lessons, title')
    .eq('telegram_id', telegramId)
    .eq('product', product)
    .eq('status', 'active');
  if (product === 'course' && courseId != null) q = q.eq('course_id', courseId);
  const { data, error } = await q.order('id', { ascending: false }).limit(1);
  if (error) throw error;
  const row = data?.[0];
  return row
    ? {
        id: row.id as number,
        total_lessons: row.total_lessons as number,
        remaining_lessons: row.remaining_lessons as number,
        title: row.title as string | undefined,
      }
    : null;
}

/** Несколько active на один курс — сливаем остатки в последний, остальные отменяем. */
async function consolidateActiveCoursePackages(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
): Promise<ActivePackageRow | null> {
  const { data: rows, error } = await admin
    .from('lesson_packages')
    .select('id, total_lessons, remaining_lessons, title')
    .eq('telegram_id', telegramId)
    .eq('product', 'course')
    .eq('course_id', courseId)
    .eq('status', 'active')
    .order('id', { ascending: false });
  if (error) throw error;
  if (!rows?.length) return null;
  if (rows.length === 1) {
    const r = rows[0];
    return {
      id: r.id as number,
      total_lessons: r.total_lessons as number,
      remaining_lessons: r.remaining_lessons as number,
      title: r.title as string | undefined,
    };
  }

  const [primary, ...rest] = rows;
  let total = primary.total_lessons as number;
  let remaining = primary.remaining_lessons as number;
  for (const p of rest) {
    total += p.total_lessons as number;
    remaining += p.remaining_lessons as number;
  }
  const now = new Date().toISOString();
  const { error: mergeError } = await admin
    .from('lesson_packages')
    .update({ total_lessons: total, remaining_lessons: remaining, updated_at: now })
    .eq('id', primary.id);
  if (mergeError) throw mergeError;

  const dupIds = rest.map((p) => p.id as number);
  if (dupIds.length > 0) {
    const { error: cancelError } = await admin
      .from('lesson_packages')
      .update({ status: 'cancelled', updated_at: now })
      .in('id', dupIds);
    if (cancelError) throw cancelError;
  }

  return {
    id: primary.id as number,
    total_lessons: total,
    remaining_lessons: remaining,
    title: primary.title as string | undefined,
  };
}

export async function recordPayment(
  admin: SupabaseClient,
  telegramId: number,
  product: AccessProduct,
  amountByn: number,
  packageId?: number,
  externalId?: string,
): Promise<void> {
  const { error } = await admin.from('payments').insert({
    telegram_id: telegramId,
    product,
    amount_byn: amountByn,
    package_id: packageId ?? null,
    external_id: externalId ?? null,
  });
  if (error) throw error;
}

/** Зачисление на курс при покупке + жизни, если ученик уже был записан ранее. */
export async function ensureCourseEnrollmentOnPurchase(
  admin: SupabaseClient,
  telegramId: number,
  courseId?: number,
  options?: { courseSlug?: string },
): Promise<number | null> {
  const targetCourseId = await resolveCourseId(admin, courseId);
  if (!targetCourseId) return null;

  const { data: existingRows, error: existingError } = await admin
    .from('course_enrollments')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('course_id', targetCourseId)
    .eq('status', 'active')
    .order('id', { ascending: false })
    .limit(1);
  if (existingError) throw existingError;
  const existing = existingRows?.[0] ?? null;

  if (!existing) {
    await enrollStudent(admin, telegramId, targetCourseId);
  }

  try {
    const lives = await getEnrollmentLives(admin, telegramId, targetCourseId);
    // После full block + новая оплата: сброс прогресса и блокировок «с нуля».
    if (lives?.fully_blocked) {
      const slug = options?.courseSlug;
      const courseContent = slug
        ? await getDistrictCourseContent(slug).catch(() => null)
        : await getDistrictCourseContent().catch(() => null);
      await resetCourseLearningForRepurchase(
        admin,
        telegramId,
        targetCourseId,
        courseContent,
      );
    } else if (existing) {
      await initEnrollmentLives(admin, telegramId, targetCourseId);
    }
  } catch (error) {
    if (!isLivesTableError(error) && !isCourseAccessTableError(error)) throw error;
  }

  return targetCourseId;
}

async function resolveCourseId(admin: SupabaseClient, courseId?: number): Promise<number | null> {
  if (courseId) return courseId;
  const courseContent = await getDistrictCourseContent().catch(() => null);
  const fromContent = await resolveCourseIdForContent(admin, courseContent);
  if (fromContent) return fromContent;
  const courses = await getActiveCourses(admin);
  return courses[0]?.id ?? null;
}

/**
 * После fulfill_purchase_full (bePaid): жизни, открытие текущего урока.
 * user_accesses / lesson_packages / enrollment уже созданы в RPC.
 */
export async function completeCoursePurchaseSideEffects(
  admin: SupabaseClient,
  telegramId: number,
  options: {
    courseId: number;
    courseSlug?: string;
    packageId: number;
    lessons: number;
    curatorTelegramId?: number;
  },
): Promise<void> {
  let courseSlug = options.courseSlug;
  if (!courseSlug) {
    const { data: courseRow } = await admin
      .from('courses')
      .select('slug')
      .eq('id', options.courseId)
      .maybeSingle();
    courseSlug = (courseRow?.slug as string | undefined) ?? undefined;
  }

  await ensureCourseEnrollmentOnPurchase(admin, telegramId, options.courseId, {
    courseSlug,
  });

  try {
    const courseContent = courseSlug
      ? await getDistrictCourseContent(courseSlug).catch(() => null)
      : await getDistrictCourseContent().catch(() => null);
    await grantPackageLessonAccess(
      admin,
      telegramId,
      options.courseId,
      options.packageId,
      options.lessons,
      courseContent,
    );
    const { syncJoinCurrentEnrollmentAccess } = await import('./education/course-access');
    await syncJoinCurrentEnrollmentAccess(
      admin,
      telegramId,
      options.courseId,
      courseContent,
      options.packageId,
    );
  } catch (error) {
    if (!isCourseAccessTableError(error)) throw error;
  }
}

/** Оплата из бота: доступ + пакет + запись платежа. */
export async function completeProductPurchase(
  admin: SupabaseClient,
  telegramId: number,
  product: AccessProduct,
  options: {
    title: string;
    lessons: number;
    amountByn: number;
    expiresAt?: string | null;
    externalId?: string;
    courseId?: number;
    courseSlug?: string;
    curatorTelegramId?: number;
    teacherSanityId?: string;
    purchaseRequestId?: string;
  },
): Promise<{ packageId: number; lessonsGranted: number; curatorAssigned: boolean; teacherAssigned: boolean }> {
  await grantAccess(admin, telegramId, product, { expiresAt: options.expiresAt ?? null });

  let resolvedCourseId: number | null = null;
  let curatorAssigned = false;
  let teacherAssigned = false;
  if (product === 'course') {
    let courseSlug = options.courseSlug;
    resolvedCourseId = await ensureCourseEnrollmentOnPurchase(admin, telegramId, options.courseId, {
      courseSlug,
    });
    if (!courseSlug && resolvedCourseId) {
      const { data: courseRow } = await admin
        .from('courses')
        .select('slug')
        .eq('id', resolvedCourseId)
        .maybeSingle();
      courseSlug = (courseRow?.slug as string | undefined) ?? undefined;
    }
  }

  if ((product === 'individual' || product === 'group') && options.teacherSanityId) {
    try {
      const teacherTelegramId = await resolveTeacherTelegramId(admin, options.teacherSanityId);
      if (teacherTelegramId) {
        await assignTeacher(admin, telegramId, teacherTelegramId);
        teacherAssigned = true;
      }
    } catch (error) {
      console.error('[purchase] teacher assignment failed:', error);
    }
  }

  const pkg = await grantLessonPackage(admin, telegramId, product, {
    title: options.title,
    lessons: options.lessons,
    expiresAt: options.expiresAt,
    purchaseRequestId: options.purchaseRequestId,
    courseId: product === 'course' ? (resolvedCourseId ?? options.courseId ?? null) : null,
  });

  let lessonsGranted = 0;
  if (product === 'course' && resolvedCourseId) {
    try {
      const courseContent = await getDistrictCourseContent(options.courseSlug).catch(() => null);
      lessonsGranted = await grantPackageLessonAccess(
        admin,
        telegramId,
        resolvedCourseId,
        pkg.id,
        options.lessons,
        courseContent,
      );
      if (courseContent) {
        const { syncJoinCurrentEnrollmentAccess } = await import('./education/course-access');
        await syncJoinCurrentEnrollmentAccess(
          admin,
          telegramId,
          resolvedCourseId,
          courseContent,
          pkg.id,
        );
      }
    } catch (error) {
      if (!isCourseAccessTableError(error)) throw error;
    }
  }

  try {
    await recordPayment(admin, telegramId, product, options.amountByn, pkg.id, options.externalId);
  } catch (error) {
    if (!isPackageTableError(error)) throw error;
  }
  return { packageId: pkg.id, lessonsGranted, curatorAssigned, teacherAssigned };
}

/** Ручное пополнение из админки: пакет всегда начисляется; открытие занятий — best effort. */
export async function adminManualCoursePackageTopUp(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  lessons: number,
  title: string,
  courseSlug: string,
  actorTelegramId: number,
): Promise<{ packageId: number; lessonsGranted: number; unlockWarning?: string }> {
  await grantAccess(admin, telegramId, 'course', {});

  const pkg = await grantLessonPackage(admin, telegramId, 'course', {
    title,
    lessons,
    courseId,
  });

  let lessonsGranted = 0;
  let unlockWarning: string | undefined;
  try {
    await ensureCourseEnrollmentOnPurchase(admin, telegramId, courseId, { courseSlug });
    const courseContent = await getDistrictCourseContent(courseSlug).catch(() => null);
    lessonsGranted = await grantPackageLessonAccess(
      admin,
      telegramId,
      courseId,
      pkg.id,
      lessons,
      courseContent,
    );
    if (courseContent) {
      const { syncJoinCurrentEnrollmentAccess } = await import('./education/course-access');
      await syncJoinCurrentEnrollmentAccess(admin, telegramId, courseId, courseContent, pkg.id);
    }
  } catch (error) {
    unlockWarning =
      error instanceof Error ? error.message : 'Не удалось синхронизировать доступ к занятиям';
    console.error('[adminManualCoursePackageTopUp unlock]', error);
  }

  try {
    await recordPayment(
      admin,
      telegramId,
      'course',
      0,
      pkg.id,
      `admin-topup-${actorTelegramId}-${Date.now()}`,
    );
  } catch (error) {
    if (!isPackageTableError(error)) console.warn('[admin topup payment log]', error);
  }

  return { packageId: pkg.id, lessonsGranted, unlockWarning };
}
