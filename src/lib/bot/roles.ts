import type { SupabaseClient } from '@supabase/supabase-js';

// Роли бота District. Храним роль текстом, чтобы новые роли
// (пункт «потом добавим») добавлялись без миграций схемы.
export type BotRole = 'guest' | 'student' | 'curator' | 'admin' | 'test';

export const BOT_ROLES: BotRole[] = ['guest', 'student', 'curator', 'admin', 'test'];

export const ROLE_LABELS: Record<BotRole, string> = {
  guest: 'гость',
  student: 'ученик',
  curator: 'куратор',
  admin: 'админ',
  test: 'тестер',
};

export type MemberInfo = { role: BotRole; viewRole: BotRole | null };

// Первый админ задаётся списком ID в env, чтобы не бутстрапить через БД.
export function isAdminEnv(telegramId: number): boolean {
  return (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(String(telegramId));
}

export function isBotRole(value: string): value is BotRole {
  return (BOT_ROLES as string[]).includes(value);
}

// Регистрирует участника при первом контакте с ботом.
// Существующую роль НЕ трогает — обновляет только телефон/имя, если переданы.
export async function ensureMember(
  admin: SupabaseClient,
  telegramId: number,
  patch?: { phone?: string; full_name?: string },
): Promise<MemberInfo> {
  const { data } = await admin
    .from('bot_members')
    .select('role, view_role')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  const cleanPatch = patch
    ? Object.fromEntries(Object.entries(patch).filter(([, v]) => Boolean(v)))
    : {};

  if (data) {
    if (Object.keys(cleanPatch).length > 0) {
      await admin
        .from('bot_members')
        .update({ ...cleanPatch, updated_at: new Date().toISOString() })
        .eq('telegram_id', telegramId);
    }
    return {
      role: isBotRole(data.role) ? data.role : 'guest',
      viewRole: isBotRole(data.view_role) ? data.view_role : null,
    };
  }

  // Владелец (ID из ADMIN_TELEGRAM_IDS) сразу получает роль test.
  const role: BotRole = isAdminEnv(telegramId) ? 'test' : 'guest';
  await admin
    .from('bot_members')
    .insert({ telegram_id: telegramId, role, ...cleanPatch });
  return { role, viewRole: null };
}

// Включает/сбрасывает тест-маску (только для роли test).
export async function setViewRole(
  admin: SupabaseClient,
  telegramId: number,
  view: BotRole | null,
): Promise<void> {
  const { error } = await admin
    .from('bot_members')
    .update({ view_role: view, updated_at: new Date().toISOString() })
    .eq('telegram_id', telegramId);
  if (error) throw error;
}

export async function setRole(
  admin: SupabaseClient,
  telegramId: number,
  role: BotRole,
): Promise<boolean> {
  const { data, error } = await admin
    .from('bot_members')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('telegram_id', telegramId)
    .select();
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function listMembers(admin: SupabaseClient) {
  const { data } = await admin
    .from('bot_members')
    .select('telegram_id, role, phone, full_name')
    .order('created_at', { ascending: true })
    .limit(100);
  return data ?? [];
}
