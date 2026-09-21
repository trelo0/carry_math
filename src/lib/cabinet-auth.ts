import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isBotRole, isCreatorTelegramId, type BotRole } from '@/lib/bot/roles';

export type CabinetAuthContext = {
  phone: string;
  telegramId: number;
  admin: ReturnType<typeof createAdminClient>;
};

export type CuratorAuthContext = CabinetAuthContext & {
  role: BotRole;
  fullName: string | null;
};

const CURATOR_ROLES: BotRole[] = ['curator', 'mentor', 'admin'];

export function isCuratorCabinetRole(role: string): boolean {
  const normalized = role === 'mentor' ? 'curator' : role;
  return CURATOR_ROLES.includes(normalized as BotRole);
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

/** Куда отправить после OTP: куратор/admin → /cabinet/curator; создатель → выбор кабинета. */
export function resolveCabinetEntryPath(
  telegramId: number,
  role: string,
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

  if (isCuratorCabinetRole(role)) {
    if (safe?.startsWith('/cabinet/lesson/') || safe?.startsWith('/cabinet/checkout')) {
      return safe;
    }
    return '/cabinet/curator';
  }

  if (safe?.startsWith('/cabinet/curator')) return '/cabinet';
  return safe ?? '/cabinet';
}

/** По телефону — путь входа в кабинет с учётом роли в bot_members. */
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
  const { data: member } = await admin
    .from('bot_members')
    .select('role')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  const role = (member?.role as string | undefined) ?? 'guest';
  return resolveCabinetEntryPath(telegramId, role, preferredPath);
}

/** Авторизация веб-кабинета куратора: phone → telegram_id + role curator/mentor/admin. */
export async function getCuratorAuth(): Promise<CuratorAuthContext | null> {
  const base = await getCabinetAuth();
  if (!base) return null;

  const { data: member } = await base.admin
    .from('bot_members')
    .select('role, full_name')
    .eq('telegram_id', base.telegramId)
    .maybeSingle();

  const roleRaw = member?.role as string | undefined;
  const role: BotRole = roleRaw && isBotRole(roleRaw) ? roleRaw : 'guest';
  if (!isCuratorCabinetRole(role) && !isCreatorTelegramId(base.telegramId)) return null;

  return {
    ...base,
    role,
    fullName: (member?.full_name as string | null) ?? null,
  };
}
