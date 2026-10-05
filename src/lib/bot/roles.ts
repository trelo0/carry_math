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

/** Создатель из env — полные права бота независимо от текущей роли в БД. */
export function isCreatorTelegramId(telegramId: number): boolean {
  return isAdminEnv(telegramId);
}

/** Админ-команды и сценарии всех ролей (создатель или role=admin). */
export function hasCreatorPowers(telegramId: number, role: BotRole): boolean {
  return isCreatorTelegramId(telegramId) || role === 'admin';
}

/** /as, /role, /users — создатель из env не теряет доступ при role=guest. */
export function canManageBotRoles(telegramId: number, role: BotRole): boolean {
  return isCreatorTelegramId(telegramId) || role === 'admin' || role === 'test';
}

/** Владелец из env, роль admin или test — могут использовать /as и менять роли. */
export function canUseTesterTools(telegramId: number, role: BotRole): boolean {
  return canManageBotRoles(telegramId, role);
}

/** Роль для UI бота с учётом тест-маски (/as). */
export function resolveEffectiveRole(member: MemberInfo, telegramId: number): BotRole {
  if (
    canUseTesterTools(telegramId, member.role) &&
    member.viewRole &&
    member.viewRole !== 'test'
  ) {
    return member.viewRole;
  }
  // Создатель с role=guest в БД — гостевой UI на /start; админка: /admin или role=admin.
  return member.role;
}

export function resolveEffectiveRoleWithFooter(
  member: MemberInfo,
  telegramId: number,
): { role: BotRole; testFooter: string } {
  const role = resolveEffectiveRole(member, telegramId);
  const masked =
    canUseTesterTools(telegramId, member.role) &&
    member.viewRole &&
    member.viewRole !== 'test' &&
    member.viewRole !== member.role
      ? member.viewRole
      : null;
  const testFooter = masked ? `\n\n🧪 Тест-маска: ${ROLE_LABELS[masked]}. Сброс — /as reset.` : '';
  return { role, testFooter };
}

export function isBotRole(value: string): value is BotRole {
  return (BOT_ROLES as string[]).includes(value);
}

/** mentor в БД = curator в логике приложения. */
export function normalizeMemberRole(role: string): BotRole {
  if (role === 'mentor') return 'curator';
  return isBotRole(role) ? role : 'guest';
}

export function combineMemberRoles(primaryRole: string, extraRoles: string[] | null | undefined): BotRole[] {
  const roles = new Set<BotRole>();
  roles.add(normalizeMemberRole(primaryRole));
  for (const raw of extraRoles ?? []) {
    if (raw) roles.add(normalizeMemberRole(raw));
  }
  return [...roles];
}

export function memberHasRole(roles: BotRole[], role: BotRole): boolean {
  const target = role === 'mentor' ? 'curator' : role;
  return roles.some((r) => (r === 'mentor' ? 'curator' : r) === target);
}

/** Только куратор без других рабочих ролей (legacy). */
export function isCuratorOnlyMember(roles: BotRole[]): boolean {
  return (
    memberHasRole(roles, 'curator') &&
    !memberHasRole(roles, 'teacher') &&
    !memberHasRole(roles, 'student')
  );
}

/** Staff (куратор / препод / admin) без роли ученика → /cabinet/staff. */
export function isStaffOnlyMember(roles: BotRole[]): boolean {
  const isStaff =
    memberHasRole(roles, 'curator') ||
    memberHasRole(roles, 'teacher') ||
    memberHasRole(roles, 'admin');
  return isStaff && !memberHasRole(roles, 'student');
}

export function memberCanAccessStaffCabinet(roles: BotRole[], telegramId: number): boolean {
  return (
    memberHasRole(roles, 'curator') ||
    memberHasRole(roles, 'teacher') ||
    memberHasRole(roles, 'admin') ||
    isCreatorTelegramId(telegramId)
  );
}

/** Создатель или admin — полный preview куратора и преподавателя в staff. */
export function hasFullStaffPreview(roles: BotRole[], telegramId: number): boolean {
  return isCreatorTelegramId(telegramId) || memberHasRole(roles, 'admin');
}

/** API преподавателя: teacher или admin/создатель в preview. */
export function canManageTeacherCabinet(roles: BotRole[], telegramId: number): boolean {
  return memberHasRole(roles, 'teacher') || hasFullStaffPreview(roles, telegramId);
}

export async function loadMemberRoles(admin: SupabaseClient, telegramId: number): Promise<BotRole[]> {
  const { data, error } = await admin
    .from('bot_members')
    .select('role, extra_roles')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return ['guest'];
  const extra = Array.isArray(data.extra_roles) ? (data.extra_roles as string[]) : [];
  return combineMemberRoles(String(data.role ?? 'guest'), extra);
}

function uniqueExtraRoles(roles: BotRole[]): BotRole[] {
  const seen = new Set<BotRole>();
  const out: BotRole[] = [];
  for (const role of roles) {
    const normalized = normalizeMemberRole(role);
    if (normalized === 'mentor' || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export async function setMemberExtraRoles(
  admin: SupabaseClient,
  telegramId: number,
  extraRoles: BotRole[],
): Promise<boolean> {
  const { data, error } = await admin
    .from('bot_members')
    .update({ extra_roles: uniqueExtraRoles(extraRoles), updated_at: new Date().toISOString() })
    .eq('telegram_id', telegramId)
    .select('telegram_id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function addMemberExtraRole(
  admin: SupabaseClient,
  telegramId: number,
  role: BotRole,
): Promise<boolean> {
  const { data, error } = await admin
    .from('bot_members')
    .select('role, extra_roles')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;

  const primary = normalizeMemberRole(String(data.role ?? 'guest'));
  const normalized = normalizeMemberRole(role);
  if (normalized === primary) return true;

  const current = Array.isArray(data.extra_roles) ? (data.extra_roles as string[]) : [];
  const combined = uniqueExtraRoles([...combineMemberRoles(primary, current), normalized].filter((r) => r !== primary));
  return setMemberExtraRoles(admin, telegramId, combined);
}

export async function removeMemberExtraRole(
  admin: SupabaseClient,
  telegramId: number,
  role: BotRole,
): Promise<boolean> {
  const { data, error } = await admin
    .from('bot_members')
    .select('role, extra_roles')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;

  const target = normalizeMemberRole(role);
  const primary = normalizeMemberRole(String(data.role ?? 'guest'));
  const current = Array.isArray(data.extra_roles) ? (data.extra_roles as string[]) : [];
  const next = uniqueExtraRoles(
    combineMemberRoles(primary, current).filter((r) => r !== target && r !== primary),
  );
  return setMemberExtraRoles(admin, telegramId, next);
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

  const roleForInsert: BotRole = isAdminEnv(telegramId) ? 'admin' : initialRole;
  const { error: insertError } = await admin
    .from('bot_members')
    .insert({ telegram_id: telegramId, role: roleForInsert, ...cleanPatch });
  if (insertError) throw insertError;
  return { role: roleForInsert, viewRole: null };
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
