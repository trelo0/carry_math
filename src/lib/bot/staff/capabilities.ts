import type { SupabaseClient } from '@supabase/supabase-js';
import { usesClientBotUi } from '@/lib/bot/client-state';
import { listCoursesForStaff } from '@/lib/bot/education/course-staff';
import {
  canManageTeacherCabinet,
  hasFullStaffPreview,
  isBotRole,
  loadMemberRoles,
  memberHasRole,
  resolveEffectiveRole,
  type BotRole,
  type MemberInfo,
} from '@/lib/bot/roles';

export type StaffCapabilities = {
  telegramId: number;
  roles: BotRole[];
  primaryRole: BotRole;
  viewRole: BotRole | null;
  effectiveRole: BotRole;
  canTeacherBot: boolean;
  /** Куратор курса (назначение curator на курс). */
  canCuratorBot: boolean;
  /** Проверяющий / любое назначение на курс. */
  canCourseStaffBot: boolean;
  /** Reply «Управление курсами» (extra staff + назначение или primary staff/admin). */
  canCourseManagementBot: boolean;
};

function courseAssignmentFlags(assignments: { role: string }[]) {
  const hasCuratorAssignment = assignments.some((a) => a.role === 'curator');
  const hasCheckAssignment = assignments.some((a) => a.role === 'check');
  return {
    hasCuratorAssignment,
    hasCheckAssignment,
    hasCourseStaffAssignment: hasCuratorAssignment || hasCheckAssignment,
  };
}

/** Роли staff для Telegram: primary + extra_roles + view_role (/as). */
export async function loadStaffCapabilities(
  admin: SupabaseClient,
  telegramId: number,
): Promise<StaffCapabilities> {
  const { data, error } = await admin
    .from('bot_members')
    .select('role, view_role')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;

  const roles = await loadMemberRoles(admin, telegramId);
  const primaryRole: BotRole =
    data?.role && isBotRole(data.role) ? data.role : 'guest';
  const viewRole =
    data?.view_role && isBotRole(data.view_role) ? data.view_role : null;
  const member: MemberInfo = { role: primaryRole, viewRole };
  const effectiveRole = resolveEffectiveRole(member, telegramId);

  const assignments = await listCoursesForStaff(admin, telegramId).catch(() => []);
  const { hasCuratorAssignment, hasCourseStaffAssignment } = courseAssignmentFlags(assignments);
  const fullPreview = hasFullStaffPreview(roles, telegramId);
  const hasStaffExtra = memberHasRole(roles, 'staff');

  const canCuratorBot = fullPreview || hasCuratorAssignment;
  const canCourseStaffBot = fullPreview || hasCourseStaffAssignment;
  const canCourseManagementBot =
    fullPreview ||
    (hasCourseStaffAssignment &&
      (primaryRole === 'staff' || primaryRole === 'admin' || hasStaffExtra));

  const emptyStaff: StaffCapabilities = {
    telegramId,
    roles,
    primaryRole,
    viewRole,
    effectiveRole,
    canTeacherBot: false,
    canCuratorBot: false,
    canCourseStaffBot: false,
    canCourseManagementBot: false,
  };

  if (usesClientBotUi(effectiveRole)) {
    return emptyStaff;
  }

  if (viewRole === 'teacher') {
    return {
      ...emptyStaff,
      effectiveRole,
      canTeacherBot: true,
      canCuratorBot,
      canCourseStaffBot,
      canCourseManagementBot,
    };
  }
  if (viewRole === 'curator') {
    return {
      ...emptyStaff,
      effectiveRole,
      canCuratorBot: true,
      canCourseStaffBot: true,
      canCourseManagementBot: true,
    };
  }

  if (effectiveRole === 'staff') {
    return {
      ...emptyStaff,
      canCuratorBot,
      canCourseStaffBot,
      canCourseManagementBot,
    };
  }

  if (effectiveRole === 'teacher') {
    return {
      ...emptyStaff,
      canTeacherBot: true,
      canCuratorBot,
      canCourseStaffBot,
      canCourseManagementBot,
    };
  }

  if (effectiveRole === 'curator' || effectiveRole === 'check') {
    return {
      ...emptyStaff,
      canCuratorBot: effectiveRole === 'curator' ? hasCuratorAssignment || fullPreview : canCuratorBot,
      canCourseStaffBot,
      canCourseManagementBot,
    };
  }

  const canTeacherBot = canManageTeacherCabinet(roles, telegramId);

  return {
    telegramId,
    roles,
    primaryRole,
    viewRole,
    effectiveRole,
    canTeacherBot,
    canCuratorBot,
    canCourseStaffBot,
    canCourseManagementBot,
  };
}
