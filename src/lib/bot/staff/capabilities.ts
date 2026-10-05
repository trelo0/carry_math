import type { SupabaseClient } from '@supabase/supabase-js';
import { usesClientBotUi } from '@/lib/bot/client-state';
import {
  canManageTeacherCabinet,
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
  canCuratorBot: boolean;
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
    };
  }

  const canTeacherBot = canManageTeacherCabinet(roles, telegramId);
  const canCuratorBot =
    memberHasRole(roles, 'curator') || memberHasRole(roles, 'admin');

  return {
    telegramId,
    roles,
    primaryRole,
    viewRole,
    effectiveRole,
    canTeacherBot,
    canCuratorBot,
  };
}
