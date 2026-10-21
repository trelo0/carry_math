import type { SupabaseClient } from '@supabase/supabase-js';
import type { DistrictCourseContent } from '@/lib/studio/courseContent';
import { addMemberExtraRole, loadMemberRoles, memberHasRole, normalizeMemberRole } from '@/lib/bot/roles';
import { isRegisteredBotMember } from '@/lib/bot/teacher-mapping';

export type CourseStaffRole = 'teacher' | 'curator' | 'check';

export type CourseStaffAssignment = {
  id: number;
  course_id: number;
  staff_telegram_id: number;
  role: CourseStaffRole;
  status: string;
};

const STAFF_COLUMNS = 'id, course_id, staff_telegram_id, role, status';

async function assertEligibleForCourseStaffAssignment(
  admin: SupabaseClient,
  staffTelegramId: number,
  role: CourseStaffRole,
): Promise<void> {
  const roles = await loadMemberRoles(admin, staffTelegramId);
  if (role === 'teacher') {
    if (!memberHasRole(roles, 'teacher')) {
      throw new Error(`Нужна роль преподавателя для staff ${staffTelegramId}`);
    }
    return;
  }
  const ok =
    memberHasRole(roles, 'staff') ||
    memberHasRole(roles, 'teacher') ||
    memberHasRole(roles, 'admin');
  if (!ok) {
    throw new Error(
      `Нельзя назначить ${role}: нужна роль teacher, admin или extra staff (сейчас: ${roles.join(', ')}).`,
    );
  }
}

/** teacher/admin → extra staff; primary staff уже ок. guest/student — нельзя. */
export async function ensureStaffExtraForCourseAssignment(
  admin: SupabaseClient,
  staffTelegramId: number,
): Promise<void> {
  const { data, error } = await admin
    .from('bot_members')
    .select('role')
    .eq('telegram_id', staffTelegramId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Участник ${staffTelegramId} не найден в боте.`);
  const primary = normalizeMemberRole(String(data.role ?? 'guest'));
  if (primary === 'guest' || primary === 'student') {
    throw new Error('Нельзя назначить на курс: пользователь guest/student. Сначала teacher/admin или staff.');
  }
  if (primary === 'teacher' || primary === 'admin') {
    await addMemberExtraRole(admin, staffTelegramId, 'staff');
  }
}

/** @deprecated используй ensureStaffExtraForCourseAssignment */
export const ensureStaffPrimaryRole = ensureStaffExtraForCourseAssignment;

/** Куратор/преподаватель курса в каталоге (не привязка к ученику). */
export async function upsertCourseStaffAssignment(
  admin: SupabaseClient,
  courseId: number,
  staffTelegramId: number,
  role: CourseStaffRole,
): Promise<void> {
  await assertEligibleForCourseStaffAssignment(admin, staffTelegramId, role);
  if (role === 'curator' || role === 'check') {
    await ensureStaffExtraForCourseAssignment(admin, staffTelegramId);
  }
  const now = new Date().toISOString();

  await admin
    .from('course_staff_assignments')
    .update({ status: 'completed', ended_at: now, updated_at: now })
    .eq('course_id', courseId)
    .eq('role', role)
    .eq('status', 'active')
    .neq('staff_telegram_id', staffTelegramId);

  const { error } = await admin.from('course_staff_assignments').upsert(
    {
      course_id: courseId,
      staff_telegram_id: staffTelegramId,
      role,
      status: 'active',
      started_at: now,
      ended_at: null,
      updated_at: now,
    },
    { onConflict: 'course_id,staff_telegram_id,role' },
  );
  if (error && !String(error.message).includes('course_staff_assignments')) throw error;
}

/** Завершить активные назначения role на курсе, кроме exceptStaffTelegramId (если задан). */
export async function deactivateCourseStaffRole(
  admin: SupabaseClient,
  courseId: number,
  role: 'curator' | 'check',
  exceptStaffTelegramId?: number | null,
): Promise<void> {
  const now = new Date().toISOString();
  let q = admin
    .from('course_staff_assignments')
    .update({ status: 'completed', ended_at: now, updated_at: now })
    .eq('course_id', courseId)
    .eq('role', role)
    .eq('status', 'active');
  if (exceptStaffTelegramId != null && Number.isFinite(exceptStaffTelegramId)) {
    q = q.neq('staff_telegram_id', Math.floor(exceptStaffTelegramId));
  }
  const { error } = await q;
  if (error && !String(error.message).includes('course_staff_assignments')) throw error;
}

/** Из Sanity/CMS: куратор курса и проверяющий ДЗ. */
export async function syncCourseStaffFromContent(
  admin: SupabaseClient,
  courseId: number,
  content: DistrictCourseContent | null,
  options?: { courseSlug?: string },
): Promise<void> {
  if (!courseId || !content) return;

  const syncRoleFromSanity = async (
    telegramId: number | null | undefined,
    role: 'curator' | 'check',
  ): Promise<void> => {
    if (telegramId == null || !Number.isFinite(telegramId)) {
      await deactivateCourseStaffRole(admin, courseId, role);
      return;
    }
    const id = Math.floor(telegramId);
    await deactivateCourseStaffRole(admin, courseId, role, id);
    if (!(await isRegisteredBotMember(admin, id))) return;
    try {
      await upsertCourseStaffAssignment(admin, courseId, id, role);
    } catch (e) {
      console.warn(`[course-staff] ${role} sync failed:`, e);
    }
  };

  await syncRoleFromSanity(content.curatorTelegramId, 'curator');
  await syncRoleFromSanity(content.checkTelegramId, 'check');
}

/** @deprecated Не вызывать при каждом открытии списка — перезаписывает ручное снятие назначения. */
export async function refreshStaffCourseAssignmentsForMember(
  admin: SupabaseClient,
  _staffTelegramId: number,
): Promise<void> {
  /* no-op: назначения синхронизируются через syncCourseStaffFromContent при загрузке курса */
}

/** Назначение из админ-бота (с проверкой роли в bot_members). */
export async function assignCourseStaffFromAdmin(
  admin: SupabaseClient,
  courseId: number,
  staffTelegramId: number,
  role: 'curator' | 'check',
): Promise<void> {
  await upsertCourseStaffAssignment(admin, courseId, staffTelegramId, role);
}

export async function staffHasAnyCourseAssignment(
  admin: SupabaseClient,
  staffTelegramId: number,
  role?: CourseStaffRole,
): Promise<boolean> {
  let q = admin
    .from('course_staff_assignments')
    .select('id')
    .eq('staff_telegram_id', staffTelegramId)
    .eq('status', 'active')
    .limit(1);
  if (role) q = q.eq('role', role);
  const { data, error } = await q;
  if (error) {
    if (String(error.message).includes('course_staff_assignments')) return false;
    throw error;
  }
  return (data ?? []).length > 0;
}

export async function listActiveCourseStaff(
  admin: SupabaseClient,
  courseId: number,
  role?: CourseStaffRole,
): Promise<CourseStaffAssignment[]> {
  let q = admin
    .from('course_staff_assignments')
    .select(STAFF_COLUMNS)
    .eq('course_id', courseId)
    .eq('status', 'active');
  if (role) q = q.eq('role', role);
  const { data, error } = await q;
  if (error) {
    if (String(error.message).includes('course_staff_assignments')) return [];
    throw error;
  }
  return (data ?? []) as CourseStaffAssignment[];
}

export async function listCoursesForStaff(
  admin: SupabaseClient,
  staffTelegramId: number,
  role?: CourseStaffRole,
): Promise<{ courseId: number; role: CourseStaffRole }[]> {
  let q = admin
    .from('course_staff_assignments')
    .select('course_id, role')
    .eq('staff_telegram_id', staffTelegramId)
    .eq('status', 'active');
  if (role) q = q.eq('role', role);
  const { data, error } = await q;
  if (error) {
    if (String(error.message).includes('course_staff_assignments')) return [];
    throw error;
  }
  return (data ?? []).map((r) => ({
    courseId: r.course_id as number,
    role: r.role as CourseStaffRole,
  }));
}

export async function staffHasCourseAccess(
  admin: SupabaseClient,
  staffTelegramId: number,
  courseId: number,
  role: CourseStaffRole,
): Promise<boolean> {
  const { data, error } = await admin
    .from('course_staff_assignments')
    .select('id')
    .eq('course_id', courseId)
    .eq('staff_telegram_id', staffTelegramId)
    .eq('role', role)
    .eq('status', 'active')
    .maybeSingle();
  if (error) {
    if (String(error.message).includes('course_staff_assignments')) return false;
    throw error;
  }
  return Boolean(data);
}

export async function resolveCourseCuratorStaffTelegramId(
  admin: SupabaseClient,
  courseId: number,
): Promise<number | null> {
  const rows = await listActiveCourseStaff(admin, courseId, 'curator');
  return rows[0]?.staff_telegram_id ?? null;
}

export async function resolveCourseCheckStaffTelegramId(
  admin: SupabaseClient,
  courseId: number,
): Promise<number | null> {
  const rows = await listActiveCourseStaff(admin, courseId, 'check');
  return rows[0]?.staff_telegram_id ?? null;
}
