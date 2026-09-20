import type { SupabaseClient } from '@supabase/supabase-js';
import { type AccessProduct, grantAccess, isAccessTableError } from './accesses';
import {
  grantAllPublishedCourseLessons,
  isCourseAccessTableError,
} from './education/course-access';
import { resolveCourseIdForContent } from './education/course-record';
import { enrollStudent, getActiveCourses } from './education/courses';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';
import { assignCurator, assignTeacher } from './education/assignments';
import { resolveDefaultCuratorTelegramId, resolveTeacherTelegramId } from './teacher-mapping';
import { initEnrollmentLives, isLivesTableError } from './education/lives';

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
  },
): Promise<LessonPackageRow> {
  const now = new Date().toISOString();
  const { data: existing } = await admin
    .from('lesson_packages')
    .select('id, total_lessons, remaining_lessons, status')
    .eq('telegram_id', telegramId)
    .eq('product', product)
    .eq('status', 'active')
    .maybeSingle();

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
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as LessonPackageRow;
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
): Promise<number | null> {
  const targetCourseId = await resolveCourseId(admin, courseId);
  if (!targetCourseId) return null;

  const { data: existing } = await admin
    .from('course_enrollments')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('course_id', targetCourseId)
    .eq('status', 'active')
    .maybeSingle();

  if (!existing) {
    await enrollStudent(admin, telegramId, targetCourseId);
    return targetCourseId;
  }

  try {
    await initEnrollmentLives(admin, telegramId, targetCourseId);
  } catch (error) {
    if (!isLivesTableError(error)) throw error;
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

async function ensureCuratorOnCoursePurchase(
  admin: SupabaseClient,
  telegramId: number,
  curatorTelegramId?: number,
): Promise<boolean> {
  const targetId =
    curatorTelegramId ?? (await resolveDefaultCuratorTelegramId(admin));
  if (!targetId) return false;

  const { data: existing } = await admin
    .from('mentor_assignments')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('kind', 'curator')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (existing) return true;

  try {
    await assignCurator(admin, telegramId, targetId);
    return true;
  } catch (error) {
    console.error('[purchase] curator assignment failed:', error);
    return false;
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
    curatorTelegramId?: number;
    teacherSanityId?: string;
  },
): Promise<{ packageId: number; lessonsGranted: number; curatorAssigned: boolean; teacherAssigned: boolean }> {
  await grantAccess(admin, telegramId, product, { expiresAt: options.expiresAt ?? null });

  let resolvedCourseId: number | null = null;
  let curatorAssigned = false;
  let teacherAssigned = false;
  if (product === 'course') {
    resolvedCourseId = await ensureCourseEnrollmentOnPurchase(admin, telegramId, options.courseId);
    curatorAssigned = await ensureCuratorOnCoursePurchase(admin, telegramId, options.curatorTelegramId);
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
  });

  let lessonsGranted = 0;
  if (product === 'course' && resolvedCourseId) {
    try {
      const courseContent = await getDistrictCourseContent().catch(() => null);
      lessonsGranted = await grantAllPublishedCourseLessons(
        admin,
        telegramId,
        resolvedCourseId,
        pkg.id,
        courseContent,
      );
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
