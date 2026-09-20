import type { SupabaseClient } from '@supabase/supabase-js';
import { getCabinetPricing } from '@/lib/studio/cabinetSettings';

const TEACHER_ROLES = new Set(['teacher']);
const CURATOR_ROLES = new Set(['curator', 'mentor']);

async function isBotMemberWithRole(
  admin: SupabaseClient,
  telegramId: number,
  allowedRoles: Set<string>,
): Promise<boolean> {
  const { data, error } = await admin
    .from('bot_members')
    .select('role')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  const role = data?.role as string | undefined;
  return !!role && allowedRoles.has(role);
}

/** teacherId из Sanity/checkout → telegram_id (источник: Sanity cabinetSettings.teachers). */
export async function resolveTeacherTelegramId(
  admin: SupabaseClient,
  teacherId: string,
): Promise<number | null> {
  const pricing = await getCabinetPricing().catch(() => null);
  const teacher = pricing?.teachers.find((t) => t.teacherId === teacherId);
  const telegramId = teacher?.telegramId;
  if (telegramId == null) return null;

  const ok = await isBotMemberWithRole(admin, telegramId, TEACHER_ROLES);
  return ok ? telegramId : null;
}

/** Куратор курса по умолчанию (Sanity cabinetSettings.defaultCuratorTelegramId). */
export async function resolveDefaultCuratorTelegramId(
  admin: SupabaseClient,
): Promise<number | null> {
  const pricing = await getCabinetPricing().catch(() => null);
  const telegramId = pricing?.defaultCuratorTelegramId;
  if (telegramId == null) return null;

  const ok = await isBotMemberWithRole(admin, telegramId, CURATOR_ROLES);
  return ok ? telegramId : null;
}
