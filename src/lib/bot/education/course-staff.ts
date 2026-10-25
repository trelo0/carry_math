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

/** Завершить активные назначения role на курсе, кроме keepTelegramId (null — снять всех). */
export async function endActiveCourseStaffForRole(
  admin: SupabaseClient,
  courseId: number,
  role: 'curator' | 'check',
  keepTelegramId: number | null,
): Promise<void> {
  const now = new Date().toISOString();
  let q = admin
    .from('course_staff_assignments')
    .update({ status: 'completed', ended_at: now, updated_at: now })
    .eq('course_id', courseId)
    .eq('role', role)
    .eq('status', 'active');
  if (keepTelegramId != null && Number.isFinite(keepTelegramId)) {
    q = q.neq('staff_telegram_id', Math.floor(keepTelegramId));
  }
  const { error } = await q;
  if (error && !String(error.message).includes('course_staff_assignments')) throw error;
}

export type CourseStaffSyncIds = {
  curator: number | null | undefined;
  check: number | null | undefined;
};

function normalizeStaffId(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? Math.floor(value) : null;
}

/**
 * Привести назначения курса в БД к значениям из Sanity.
 * Пустое поле в Sanity — снять назначение. Если новый сотрудник не прошёл проверку,
 * старый остаётся (курс не остаётся без сотрудника), а причина возвращается в problems.
 */
export async function syncCourseStaffIds(
  admin: SupabaseClient,
  courseId: number,
  ids: CourseStaffSyncIds,
  courseLabel = `курс #${courseId}`,
): Promise<string[]> {
  const problems: string[] = [];
  const roleLabels = { curator: 'куратор', check: 'проверяющий ДЗ' } as const;

  for (const role of ['curator', 'check'] as const) {
    const id = normalizeStaffId(role === 'curator' ? ids.curator : ids.check);
    if (id == null) {
      await endActiveCourseStaffForRole(admin, courseId, role, null);
      continue;
    }
    try {
      if (!(await isRegisteredBotMember(admin, id))) {
        problems.push(
          `${courseLabel}: ${roleLabels[role]} ${id} из Sanity не найден в боте (нужен /start).`,
        );
        continue;
      }
      await upsertCourseStaffAssignment(admin, courseId, id, role);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      problems.push(`${courseLabel}: ${roleLabels[role]} ${id} — ${reason}`);
      console.warn(`[course-staff] ${role} sync failed:`, e);
    }
  }
  return problems;
}

/** Из Sanity/CMS: куратор курса и проверяющий ДЗ. */
export async function syncCourseStaffFromContent(
  admin: SupabaseClient,
  courseId: number,
  content: DistrictCourseContent | null,
  options?: { courseSlug?: string },
): Promise<void> {
  if (!courseId || !content) return;
  await syncCourseStaffIds(
    admin,
    courseId,
    { curator: content.curatorTelegramId, check: content.checkTelegramId },
    options?.courseSlug ?? content.slug,
  );
}

const SYNC_TTL_MS = 15_000;
let lastSyncAt = 0;
let lastSyncProblems: string[] = [];
let inflightSync: Promise<string[]> | null = null;

/**
 * Синхронизировать сотрудников ВСЕХ курсов из Sanity (свежие данные, без кеша Next).
 * Троттлинг 15 с; параллельные вызовы делят один запуск.
 */
export async function syncAllCourseStaffFromSanity(
  admin: SupabaseClient,
  options?: { force?: boolean },
): Promise<{ problems: string[] }> {
  if (!options?.force && Date.now() - lastSyncAt < SYNC_TTL_MS) {
    return { problems: lastSyncProblems };
  }
  if (inflightSync) return { problems: await inflightSync };

  inflightSync = (async () => {
    const { listDistrictCourseSummaries, getDistrictCourseContent } = await import(
      '@/lib/studio/courseContent'
    );
    const { ensureDistrictCourseRecord, lookupCourseIdsBySlugs } = await import('./course-record');

    const summaries = await listDistrictCourseSummaries({ fresh: true }).catch((e) => {
      console.warn('[course-staff] sanity summaries failed:', e);
      return null;
    });
    if (!summaries) return lastSyncProblems;

    const idBySlug = await lookupCourseIdsBySlugs(
      admin,
      summaries.map((s) => s.slug),
    ).catch(() => new Map<string, number>());

    const results = await Promise.all(
      summaries.map(async (summary) => {
        const courseId = idBySlug.get(summary.slug);
        if (courseId != null) {
          return syncCourseStaffIds(
            admin,
            courseId,
            { curator: summary.curatorTelegramId, check: summary.checkTelegramId },
            summary.title,
          );
        }
        // Курса ещё нет в БД: создаём запись (staff синхронизируется внутри).
        const content = await getDistrictCourseContent(summary.slug, { fresh: true }).catch(
          () => null,
        );
        if (content) await ensureDistrictCourseRecord(admin, content).catch(() => null);
        return [] as string[];
      }),
    );

    const problems = results.flat();
    lastSyncAt = Date.now();
    lastSyncProblems = problems;
    return problems;
  })();

  try {
    return { problems: await inflightSync };
  } finally {
    inflightSync = null;
  }
}

/** Синхронизация без выброса ошибок — для горячих путей (кабинет, бот). */
export async function safeSyncCourseStaff(
  admin: SupabaseClient,
  options?: { force?: boolean },
): Promise<string[]> {
  try {
    return (await syncAllCourseStaffFromSanity(admin, options)).problems;
  } catch (e) {
    console.warn('[course-staff] sync failed:', e);
    return [];
  }
}

/** @deprecated используй syncAllCourseStaffFromSanity */
export async function refreshStaffCourseAssignmentsForMember(
  admin: SupabaseClient,
  _staffTelegramId: number,
): Promise<void> {
  await syncAllCourseStaffFromSanity(admin);
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
