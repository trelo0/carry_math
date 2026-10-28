import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { combineMemberRoles, memberHasRole, type BotRole } from '@/lib/bot/roles';

/** Кэш привязки телефона к admin (короткий TTL — меньше запросов при переходах между разделами). */
const resolveAdminAccess = unstable_cache(
  async (phone: string): Promise<{ telegramId: number; displayName: string | null } | null> => {
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

    const telegramId = link.telegram_id as number;
    const { data: member, error: memberError } = await admin
      .from('bot_members')
      .select('role, extra_roles, full_name')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    if (memberError) throw memberError;

    const extra = Array.isArray(member?.extra_roles) ? (member.extra_roles as string[]) : [];
    const roles: BotRole[] = combineMemberRoles(String(member?.role ?? 'guest'), extra);
    if (!memberHasRole(roles, 'admin')) return null;

    return { telegramId, displayName: (member?.full_name as string | null) ?? null };
  },
  ['admin-panel-access'],
  { revalidate: 45, tags: ['admin-panel-auth'] },
);

export type AdminCabinetContext = {
  phone: string;
  telegramId: number;
  admin: ReturnType<typeof createAdminClient>;
  displayName: string | null;
};

export type AdminAuthUser = {
  id: string;
  phone?: string;
  user_metadata?: { phone?: unknown } & Record<string, unknown>;
};

/**
 * Один вызов auth на RSC-запрос. getClaims() проверяет подпись JWT (JWKS, без запроса к Auth
 * для асимметричных ключей); без валидных claims — getUser().
 */
export const getSupabaseAuthUser = cache(async (): Promise<AdminAuthUser | null> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (claims?.sub) {
    return {
      id: claims.sub,
      phone: typeof claims.phone === 'string' ? claims.phone : undefined,
      user_metadata: (claims.user_metadata as AdminAuthUser['user_metadata']) ?? {},
    };
  }
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});

/** Кеш на один RSC-запрос (layout + page). */
export const getAdminCabinetContext = cache(async (): Promise<AdminCabinetContext | null> => {
  const user = await getSupabaseAuthUser();
  if (!user) return null;

  const phone = (user.user_metadata?.phone as string) ?? user.phone ?? '';
  if (!phone) return null;

  const access = await resolveAdminAccess(phone);
  if (!access) return null;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return null;
  }

  return {
    phone,
    telegramId: access.telegramId,
    admin,
    displayName: access.displayName,
  };
});

export const ADMIN_COURSES_PATH = '/cabinet/admin/courses';
export const ADMIN_HOME_PATH = ADMIN_COURSES_PATH;
