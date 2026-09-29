import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  hasFullStaffPreview,
  isBotRole,
  isCreatorTelegramId,
  isStaffOnlyMember,
  loadMemberRoles,
  memberCanAccessStaffCabinet,
  memberHasRole,
  type BotRole,
} from '@/lib/bot/roles';

export type CabinetAuthContext = {
  phone: string;
  telegramId: number;
  admin: ReturnType<typeof createAdminClient>;
};

export type StaffAuthContext = CabinetAuthContext & {
  role: BotRole;
  roles: BotRole[];
  fullName: string | null;
};

/** @deprecated используй StaffAuthContext */
export type CuratorAuthContext = StaffAuthContext;

const CURATOR_ROLES: BotRole[] = ['curator', 'mentor', 'admin'];

export function isCuratorCabinetRole(role: string): boolean {
  const normalized = role === 'mentor' ? 'curator' : role;
  return CURATOR_ROLES.includes(normalized as BotRole);
}

export function memberCanAccessCuratorCabinet(roles: BotRole[], telegramId: number): boolean {
  return memberHasRole(roles, 'curator') || hasFullStaffPreview(roles, telegramId);
}

/** Авторизация кабинета: phone → telegram_id. */
export async function getCabinetAuth(): Promise<CabinetAuthContext | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const phone = (auth.user.user_metadata?.phone as string) ?? auth.user.phone ?? '';
  if (!phone) return null;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  const { data: link } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', phone)
    .maybeSingle();
  if (!link?.telegram_id) return null;

  return { phone, telegramId: link.telegram_id as number, admin };
}

/** Куда отправить после OTP с учётом всех ролей участника. */
export function resolveCabinetEntryPath(
  telegramId: number,
  roles: BotRole[],
  preferredPath?: string | null,
): string {
  const safe =
    preferredPath && preferredPath.startsWith('/') && !preferredPath.startsWith('//')
      ? preferredPath
      : null;

  if (isCreatorTelegramId(telegramId)) {
    if (safe?.startsWith('/cabinet')) return safe;
    return '/cabinet/pick';
  }

  if (isStaffOnlyMember(roles)) {
    if (safe?.startsWith('/cabinet/lesson/') || safe?.startsWith('/cabinet/checkout')) {
      return safe;
    }
    if (safe?.startsWith('/cabinet/staff')) return safe;
    return '/cabinet/staff';
  }

  if (safe?.startsWith('/cabinet/staff') && !memberCanAccessStaffCabinet(roles, telegramId)) {
    return '/cabinet';
  }
  if (safe?.startsWith('/cabinet/curator')) {
    return safe.replace('/cabinet/curator', '/cabinet/staff');
  }
  return safe ?? '/cabinet';
}

/** По телефону — путь входа в кабинет с учётом ролей в bot_members. */
export async function resolveCabinetEntryPathForPhone(
  admin: ReturnType<typeof createAdminClient>,
  phone: string,
  preferredPath?: string | null,
): Promise<string> {
  const { data: link } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', phone)
    .maybeSingle();
  if (!link?.telegram_id) {
    const safe =
      preferredPath && preferredPath.startsWith('/') && !preferredPath.startsWith('//')
        ? preferredPath
        : null;
    return safe ?? '/cabinet';
  }

  const telegramId = link.telegram_id as number;
  const roles = await loadMemberRoles(admin, telegramId);
  return resolveCabinetEntryPath(telegramId, roles, preferredPath);
}

async function loadStaffMember(
  base: CabinetAuthContext,
): Promise<Omit<StaffAuthContext, keyof CabinetAuthContext> | null> {
  const roles = await loadMemberRoles(base.admin, base.telegramId);
  if (!memberCanAccessStaffCabinet(roles, base.telegramId)) return null;

  const { data: member } = await base.admin
    .from('bot_members')
    .select('role, full_name')
    .eq('telegram_id', base.telegramId)
    .maybeSingle();

  const roleRaw = member?.role as string | undefined;
  const role: BotRole = roleRaw && isBotRole(roleRaw) ? roleRaw : 'guest';

  return {
    role,
    roles,
    fullName: (member?.full_name as string | null) ?? null,
  };
}

/** Staff-кабинет: curator и/или teacher. */
export async function getStaffAuth(): Promise<StaffAuthContext | null> {
  const base = await getCabinetAuth();
  if (!base) return null;
  const member = await loadStaffMember(base);
  if (!member) return null;
  return { ...base, ...member };
}

/** @deprecated используй getStaffAuth */
export async function getCuratorAuth(): Promise<StaffAuthContext | null> {
  const auth = await getStaffAuth();
  if (!auth) return null;
  if (!memberCanAccessCuratorCabinet(auth.roles, auth.telegramId)) return null;
  return auth;
}
