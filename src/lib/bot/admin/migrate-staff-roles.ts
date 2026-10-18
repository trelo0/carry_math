import type { SupabaseClient } from '@supabase/supabase-js';
import { combineMemberRoles, normalizeMemberRole, type BotRole } from '@/lib/bot/roles';
import { upsertCourseStaffAssignment } from '@/lib/bot/education/course-staff';

export type MigrateStaffRolesResult = {
  primaryUpdates: number;
  extraUpdates: number;
  assignmentsCreated: number;
};

export async function runMigrateStaffRoles(
  admin: SupabaseClient,
  options?: { dryRun?: boolean; assignLegacy?: boolean },
): Promise<MigrateStaffRolesResult> {
  const dryRun = options?.dryRun ?? false;
  const assignLegacy = options?.assignLegacy ?? false;

  const { data: members, error } = await admin
    .from('bot_members')
    .select('telegram_id, role, extra_roles, full_name');
  if (error) throw error;

  const { data: courseRows, error: courseErr } = await admin.from('courses').select('id');
  if (courseErr) throw courseErr;
  const courseIds = (courseRows ?? []).map((r) => r.id as number);

  let primaryUpdates = 0;
  let extraUpdates = 0;
  let assignmentsCreated = 0;

  for (const row of members ?? []) {
    const telegramId = row.telegram_id as number;
    const primary = normalizeMemberRole(String(row.role ?? 'guest'));
    const extras = Array.isArray(row.extra_roles) ? (row.extra_roles as string[]) : [];
    const roles = combineMemberRoles(primary, extras);

    const hadCurator = roles.includes('curator');
    const hadCheck = roles.includes('check');
    const needsStaffPrimary =
      primary === 'curator' ||
      primary === 'mentor' ||
      primary === 'check' ||
      ((primary === 'guest' || primary === 'student') && (hadCurator || hadCheck));

    const nextExtras = extras
      .map((r) => normalizeMemberRole(r))
      .filter((r) => r !== 'curator' && r !== 'check' && r !== 'mentor' && r !== primary);

    const extrasChanged =
      JSON.stringify([...new Set(nextExtras)].sort()) !==
      JSON.stringify(
        extras.map((r) => normalizeMemberRole(r)).filter((r) => r !== primary).sort(),
      );

    const skipPrimary =
      primary === 'staff' || primary === 'teacher' || primary === 'admin' || primary === 'test';
    const nextPrimary: BotRole | null = needsStaffPrimary && !skipPrimary ? 'staff' : null;

    if (nextPrimary) {
      primaryUpdates++;
      if (!dryRun) {
        await admin
          .from('bot_members')
          .update({ role: nextPrimary, updated_at: new Date().toISOString() })
          .eq('telegram_id', telegramId);
      }
    }

    if (extrasChanged) {
      extraUpdates++;
      if (!dryRun) {
        await admin
          .from('bot_members')
          .update({ extra_roles: nextExtras, updated_at: new Date().toISOString() })
          .eq('telegram_id', telegramId);
      }
    }

    if (!assignLegacy || courseIds.length === 0 || (!hadCurator && !hadCheck)) continue;

    for (const courseId of courseIds) {
      if (hadCurator) {
        const { data: ex } = await admin
          .from('course_staff_assignments')
          .select('id')
          .eq('staff_telegram_id', telegramId)
          .eq('course_id', courseId)
          .eq('role', 'curator')
          .eq('status', 'active')
          .maybeSingle();
        if (!ex) {
          assignmentsCreated++;
          if (!dryRun) {
            await upsertCourseStaffAssignment(admin, courseId, telegramId, 'curator');
          }
        }
      }
      if (hadCheck) {
        const { data: ex } = await admin
          .from('course_staff_assignments')
          .select('id')
          .eq('staff_telegram_id', telegramId)
          .eq('course_id', courseId)
          .eq('role', 'check')
          .eq('status', 'active')
          .maybeSingle();
        if (!ex) {
          assignmentsCreated++;
          if (!dryRun) {
            await upsertCourseStaffAssignment(admin, courseId, telegramId, 'check');
          }
        }
      }
    }
  }

  return { primaryUpdates, extraUpdates, assignmentsCreated };
}
