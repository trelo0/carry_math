import type { SupabaseClient } from '@supabase/supabase-js';
import { getCabinetPricing } from '@/lib/studio/cabinetSettings';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';

const TEACHER_ROLES = new Set(['teacher']);
const CURATOR_ROLES = new Set(['curator', 'mentor']);

async function isBotMemberWithRole(
  admin: SupabaseClient,
  telegramId: number,
  allowedRoles: Set<string>,
): Promise<boolean> {
  const { data, error } = await admin
    .from('bot_members')
    .select('role')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  const role = data?.role as string | undefined;
  return !!role && allowedRoles.has(role);
}

/** teacherId из Sanity/checkout → telegram_id (источник: Sanity cabinetSettings.teachers). */
export async function resolveTeacherTelegramId(
  admin: SupabaseClient,
  teacherId: string,
): Promise<number | null> {
  const pricing = await getCabinetPricing().catch(() => null);
  const teacher = pricing?.teachers.find((t) => t.teacherId === teacherId);
  const telegramId = teacher?.telegramId;
  if (telegramId == null) return null;

  const ok = await isBotMemberWithRole(admin, telegramId, TEACHER_ROLES);
  return ok ? telegramId : null;
}

/** Куратор курса по умолчанию (Sanity cabinetSettings.defaultCuratorTelegramId). */
export async function resolveDefaultCuratorTelegramId(
  admin: SupabaseClient,
): Promise<number | null> {
  const pricing = await getCabinetPricing().catch(() => null);
  const telegramId = pricing?.defaultCuratorTelegramId;
  if (telegramId == null) return null;

  const ok = await isBotMemberWithRole(admin, telegramId, CURATOR_ROLES);
  return ok ? telegramId : null;
}

/**
 * Куратор для конкретного курса: districtCourse.curatorTelegramId → fallback default.
 * Проверяет роль curator/mentor в bot_members.
 */
export async function resolveCuratorTelegramIdForCourse(
  admin: SupabaseClient,
  courseSlug?: string | null,
  explicitTelegramId?: number | null,
): Promise<number | null> {
  if (explicitTelegramId != null && Number.isFinite(explicitTelegramId)) {
    const ok = await isBotMemberWithRole(admin, explicitTelegramId, CURATOR_ROLES);
    if (ok) return explicitTelegramId;
  }

  if (courseSlug) {
    const content = await getDistrictCourseContent(courseSlug).catch(() => null);
    const fromCourse = content?.curatorTelegramId;
    if (fromCourse != null) {
      const ok = await isBotMemberWithRole(admin, fromCourse, CURATOR_ROLES);
      if (ok) return fromCourse;
    }
  }

  return resolveDefaultCuratorTelegramId(admin);
}
