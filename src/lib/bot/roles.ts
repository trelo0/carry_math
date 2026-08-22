import type { SupabaseClient } from '@supabase/supabase-js';

// Роли бота District. Храним роль текстом, чтобы новые роли
// (пункт «потом добавим») добавлялись без миграций схемы.
// 'mentor' — легаси-запись из старых данных: curator и mentor — одна роль,
// назначается и отображается только curator.
export type BotRole = 'guest' | 'student' | 'curator' | 'teacher' | 'mentor' | 'admin' | 'test';

export const BOT_ROLES: BotRole[] = ['guest', 'student', 'curator', 'teacher', 'mentor', 'admin', 'test'];

export const ROLE_LABELS: Record<BotRole, string> = {
  guest: 'гость',
  student: 'ученик',
  curator: 'куратор',
  teacher: 'преподаватель',
  mentor: 'куратор',
  admin: 'админ',
  test: 'тестер',
};

// Подпись роли для интерфейса: легаси-роль mentor показываем как куратора.
export function roleLabel(role: string): string {
  const normalized: BotRole = role === 'mentor' ? 'curator' : isBotRole(role) ? role : 'guest';
  return ROLE_LABELS[normalized];
}

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

// ---------------------------------------------------------------------------
// Запросы для админ-панели: поиск и профили пользователей
// ---------------------------------------------------------------------------

export type MemberRow = {
  telegram_id: number;
  role: string;
  phone: string | null;
  full_name: string | null;
  chat_id: number | null;
  // active — обычный доступ, restricted — общение ограничено, blocked — заблокирован.
  // Поле заполняют только запросы, которые явно его выбирают: до применения
  // bot_moderation.sql колонки в таблице ещё нет.
  moderation_status?: string;
};

const MEMBER_COLUMNS = 'telegram_id, role, phone, full_name, chat_id';

export async function getMember(admin: SupabaseClient, telegramId: number): Promise<MemberRow | null> {
  const { data, error } = await admin
    .from('bot_members')
    .select(MEMBER_COLUMNS)
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as MemberRow) : null;
}

// Поиск по имени (частичное совпадение), телефону (цифры, частичное) и
// точному Telegram ID, если запрос целиком числовой.
export async function searchMembers(
  admin: SupabaseClient,
  query: string,
  limit = 20,
): Promise<MemberRow[]> {
  // Запятая и скобки ломают синтаксис or-фильтра PostgREST.
  const cleaned = query.trim().replace(/[,()]/g, '');
  if (!cleaned) return [];

  const digits = cleaned.replace(/\D/g, '');
  const filters = [
    `full_name.ilike.%${cleaned}%`,
    `phone.ilike.%${digits || cleaned}%`,
  ];
  if (/^\d+$/.test(cleaned)) filters.push(`telegram_id.eq.${cleaned}`);

  const { data, error } = await admin
    .from('bot_members')
    .select(MEMBER_COLUMNS)
    .or(filters.join(','))
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as MemberRow[];
}

// Страница пользователей по набору ролей с общим количеством.
// count: 'exact' возвращает total в заголовке ответа PostgREST.
export async function listMembersInRoles(
  admin: SupabaseClient,
  roles: string[],
  page: number,
  perPage: number,
): Promise<{ members: MemberRow[]; total: number }> {
  const from = page * perPage;
  const { data, error, count } = await admin
    .from('bot_members')
    .select(MEMBER_COLUMNS, { count: 'exact' })
    .in('role', roles)
    .order('created_at', { ascending: false })
    .range(from, from + perPage - 1);
  if (error) throw error;
  return { members: (data ?? []) as MemberRow[], total: count ?? 0 };
}

// Заявки с сайта, где контакт совпадает с телефоном участника.
export async function countLeadsByPhone(admin: SupabaseClient, phone: string): Promise<number> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 5) return 0;
  const { data, error } = await admin
    .from('leads')
    .select('id')
    .ilike('contact', `%${digits}%`);
  if (error) throw error;
  return (data ?? []).length;
}

// ---------------------------------------------------------------------------
// Модерация: статус доступа пользователя (bot_moderation.sql)
// ---------------------------------------------------------------------------

export type ModerationStatus = 'active' | 'restricted' | 'blocked';

// Роль и статус доступа одним лёгким запросом. До применения миграции
// bot_moderation.sql колонки нет — ошибку обрабатывает вызывающий код.
export async function getModerationInfo(
  admin: SupabaseClient,
  telegramId: number,
): Promise<{ role: string; moderationStatus: ModerationStatus } | null> {
  const { data, error } = await admin
    .from('bot_members')
    .select('role, moderation_status')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { role: string; moderation_status: string | null };
  const moderationStatus: ModerationStatus =
    row.moderation_status === 'blocked' || row.moderation_status === 'restricted'
      ? row.moderation_status
      : 'active';
  return { role: row.role, moderationStatus };
}

// Смена статуса доступа. Для active снимает служебные отметки, чтобы
// разблокировка возвращала пользователя в исходное состояние.
export async function setModerationStatus(
  admin: SupabaseClient,
  telegramId: number,
  status: ModerationStatus,
  adminTelegramId: number,
): Promise<boolean> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    moderation_status: status,
    updated_at: now,
  };
  if (status === 'blocked') {
    patch.blocked_at = now;
    patch.blocked_by = adminTelegramId;
  } else if (status === 'restricted') {
    patch.restricted_at = now;
    patch.restricted_by = adminTelegramId;
  } else {
    patch.blocked_at = null;
    patch.blocked_by = null;
    patch.restricted_at = null;
    patch.restricted_by = null;
  }
  const { data, error } = await admin
    .from('bot_members')
    .update(patch)
    .eq('telegram_id', telegramId)
    .select('telegram_id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

// Список пользователей со статусом модерации (для «Заблокированные»).
export async function listMembersByModeration(
  admin: SupabaseClient,
  status: ModerationStatus,
  page: number,
  perPage: number,
): Promise<{ members: Array<MemberRow & { blocked_at?: string | null }>; total: number }> {
  const from = page * perPage;
  const { data, error, count } = await admin
    .from('bot_members')
    .select(`${MEMBER_COLUMNS}, moderation_status, blocked_at, restricted_at`, { count: 'exact' })
    .eq('moderation_status', status)
    .order('updated_at', { ascending: false })
    .range(from, from + perPage - 1);
  if (error) throw error;
  return { members: (data ?? []) as Array<MemberRow & { blocked_at?: string | null }>, total: count ?? 0 };
}
