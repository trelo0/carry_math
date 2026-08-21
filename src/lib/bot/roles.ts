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

export type MemberPatch = {
  phone?: string;
  chat_id?: number;
  full_name?: string;
};

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
// Существующую роль не трогает, а доступные данные Telegram обновляет.

export async function ensureMember(
  admin: SupabaseClient,
  telegramId: number,
  patch?: MemberPatch,
  initialRole: BotRole = 'guest',
): Promise<MemberInfo> {
  const { data, error: findError } = await admin
    .from('bot_members')
    .select('role, view_role')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (findError) throw findError;

  const cleanPatch = patch
    ? Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined && value !== null && value !== ''),
      )
    : {};

  if (data) {
        if (Object.keys(cleanPatch).length > 0) {
      const { error: updateError } = await admin
        .from('bot_members')
        .update({ ...cleanPatch, updated_at: new Date().toISOString() })
        .eq('telegram_id', telegramId);
      if (updateError) throw updateError;
    }

    return {
      role: isBotRole(data.role) ? data.role : 'guest',
      viewRole: isBotRole(data.view_role) ? data.view_role : null,
    };
  }

  const { error: insertError } = await admin
    .from('bot_members')
    .insert({ telegram_id: telegramId, role: initialRole, ...cleanPatch });
  if (insertError) throw insertError;
  return { role: initialRole, viewRole: null };
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
