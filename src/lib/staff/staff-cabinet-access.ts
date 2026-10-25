import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hasFullStaffPreview,
  isCreatorTelegramId,
  loadMemberRoles,
  memberHasRole,
  type BotRole,
} from '@/lib/bot/roles';
import { listCoursesForStaff, safeSyncCourseStaff } from '@/lib/bot/education/course-staff';
import { buildStaffCabinetPath } from '@/lib/staff/staff-cabinet-url';

/** Доступ к /cabinet/staff: teacher/admin/creator или staff с назначением curator (не check-only). */
export async function memberCanAccessStaffCabinetWeb(
  admin: SupabaseClient,
  telegramId: number,
  roles?: BotRole[],
): Promise<boolean> {
  const r = roles ?? (await loadMemberRoles(admin, telegramId));
  if (isCreatorTelegramId(telegramId) || memberHasRole(r, 'admin')) return true;
  if (memberHasRole(r, 'teacher')) return true;

  await safeSyncCourseStaff(admin);
  const assignments = await listCoursesForStaff(admin, telegramId);
  const hasCurator = assignments.some((a) => a.role === 'curator');
  if (!hasCurator) return false;

  return memberHasRole(r, 'staff');
}

/** Deep-link для кнопки «Панель» в Telegram. */
export async function resolveStaffCabinetLoginPath(
  admin: SupabaseClient,
  telegramId: number,
): Promise<string> {
  const roles = await loadMemberRoles(admin, telegramId);
  const fullPreview = hasFullStaffPreview(roles, telegramId);

  if (fullPreview || memberHasRole(roles, 'teacher')) {
    return buildStaffCabinetPath({ section: 'teacher-calendar' });
  }

  const assignments = await listCoursesForStaff(admin, telegramId);
  if (assignments.some((a) => a.role === 'curator')) {
    return buildStaffCabinetPath({ section: 'course-list' });
  }

  return buildStaffCabinetPath({ section: 'course-list' });
}

export async function resolveCuratorWebCabinetPath(
  admin: SupabaseClient,
  telegramId: number,
  courseId?: number | null,
): Promise<string> {
  const can = await memberCanAccessStaffCabinetWeb(admin, telegramId);
  if (!can) return buildStaffCabinetPath({ section: 'course-list' });

  if (courseId != null && Number.isFinite(courseId)) {
    return buildStaffCabinetPath({
      section: 'course-overview',
      courseId,
      courseRole: 'curator',
    });
  }
  return buildStaffCabinetPath({ section: 'course-list', courseRole: 'curator' });
}
