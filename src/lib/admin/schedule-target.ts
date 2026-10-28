import type { SupabaseClient } from '@supabase/supabase-js';
import { canManageTeacherCabinet, loadMemberRoles } from '@/lib/bot/roles';

export function parseTeacherTelegramId(
  url: URL,
  body?: { teacherTelegramId?: unknown },
): number | null {
  const raw =
    body?.teacherTelegramId ??
    url.searchParams.get('teacherTelegramId') ??
    url.searchParams.get('teacher');
  const id = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(id) || id <= 0) return null;
  return Math.trunc(id);
}

export async function assertScheduleTeacherTarget(
  admin: SupabaseClient,
  teacherTelegramId: number,
): Promise<{ ok: true; fullName: string | null } | { ok: false; status: number; error: string }> {
  // teacher или admin (у админа в кабинете teacher полный доступ, как и в боте).
  const roles = await loadMemberRoles(admin, teacherTelegramId);
  const canTeach = canManageTeacherCabinet(roles, teacherTelegramId);
  if (!canTeach) {
    return { ok: false, status: 404, error: 'Преподаватель не найден' };
  }
  const { data: member } = await admin
    .from('bot_members')
    .select('full_name')
    .eq('telegram_id', teacherTelegramId)
    .maybeSingle();
  return { ok: true, fullName: (member?.full_name as string | null) ?? null };
}
