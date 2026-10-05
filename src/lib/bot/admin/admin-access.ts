import type { SupabaseClient } from '@supabase/supabase-js';
import { isBotRole, normalizeMemberRole } from '@/lib/bot/roles';
import { isAdmin } from './core';

/** Админ с маской /as — текст отдаём client/staff, не перехватываем ADMIN_UNKNOWN. */
export async function shouldAdminDeferTextToMaskedUi(
  admin: SupabaseClient,
  telegramId: number,
): Promise<boolean> {
  if (!(await isAdmin(admin, telegramId))) return false;
  const { data, error } = await admin
    .from('bot_members')
    .select('role, view_role')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.view_role || !isBotRole(String(data.view_role))) return false;
  const mask = normalizeMemberRole(String(data.view_role));
  if (mask === 'admin' || mask === 'test') return false;
  const primary = normalizeMemberRole(String(data.role ?? 'guest'));
  return mask !== primary;
}
