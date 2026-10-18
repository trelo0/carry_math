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
  /** Кураторские разделы бота (назначение curator на курс). */
  canCuratorBot: boolean;
  /** «Мой курс» и check-меню (любое назначение curator/check). */
  canCourseStaffBot: boolean;
};

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
  const hasCuratorAssignment = assignments.some((a) => a.role === 'curator');
  const hasCheckAssignment = assignments.some((a) => a.role === 'check');
  const hasCourseStaffAssignment = hasCuratorAssignment || hasCheckAssignment;

  const fullPreview = hasFullStaffPreview(roles, telegramId);
  const legacyCurator = memberHasRole(roles, 'curator');
  const canCuratorBot =
    fullPreview || legacyCurator || hasCuratorAssignment;
  const canCourseStaffBot =
    fullPreview || legacyCurator || memberHasRole(roles, 'check') || hasCourseStaffAssignment;

  // Маска /as guest|student или role=guest — клиентский UI, не staff (в т.ч. для создателя).
  if (usesClientBotUi(effectiveRole)) {
    return {
      telegramId,
      roles,
      primaryRole,
      viewRole,
      effectiveRole,
      canTeacherBot: false,
      canCuratorBot: false,
      canCourseStaffBot: false,
    };
  }

  // /as teacher|curator — чистый UI этой роли (не combined и не «чужое» меню).
  if (viewRole === 'teacher') {
    return {
      telegramId,
      roles,
      primaryRole,
      viewRole,
      effectiveRole,
      canTeacherBot: true,
      canCuratorBot: false,
      canCourseStaffBot: canCourseStaffBot,
    };
  }
  if (viewRole === 'curator') {
    return {
      telegramId,
      roles,
      primaryRole,
      viewRole,
      effectiveRole,
      canTeacherBot: false,
      canCuratorBot: true,
      canCourseStaffBot: true,
    };
  }

  // Реальная роль teacher/curator в БД (в т.ч. /role me … у creator).
  if (effectiveRole === 'teacher') {
    return {
      telegramId,
      roles,
      primaryRole,
      viewRole,
      effectiveRole,
      canTeacherBot: true,
      canCuratorBot: canCuratorBot,
      canCourseStaffBot,
    };
  }
  if (effectiveRole === 'curator') {
    return {
      telegramId,
      roles,
      primaryRole,
      viewRole,
      effectiveRole,
      canTeacherBot: memberHasRole(roles, 'teacher'),
      canCuratorBot: true,
      canCourseStaffBot: true,
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
  };
}
