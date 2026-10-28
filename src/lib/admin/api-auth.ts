import { getCabinetAuth, type StaffAuthContext } from '@/lib/cabinet-auth';
import { combineMemberRoles, loadMemberRoles, memberHasRole, type BotRole } from '@/lib/bot/roles';

/** API `/api/admin/*`: только реальная роль admin (без act-as teacher). */
export async function requireAdminApiAuth(): Promise<StaffAuthContext | null> {
  const base = await getCabinetAuth();
  if (!base) return null;

  const roles = await loadMemberRoles(base.admin, base.telegramId);
  if (!memberHasRole(roles, 'admin')) return null;

  const { data: member } = await base.admin
    .from('bot_members')
    .select('role, extra_roles, full_name')
    .eq('telegram_id', base.telegramId)
    .maybeSingle();

  const extra = Array.isArray(member?.extra_roles) ? (member.extra_roles as string[]) : [];
  const merged: BotRole[] = combineMemberRoles(String(member?.role ?? 'admin'), extra);
  const role: BotRole = memberHasRole(merged, 'admin') ? 'admin' : merged[0] ?? 'admin';

  return {
    phone: base.phone,
    telegramId: base.telegramId,
    admin: base.admin,
    role,
    roles: merged,
    fullName: (member?.full_name as string | null) ?? null,
  };
}
