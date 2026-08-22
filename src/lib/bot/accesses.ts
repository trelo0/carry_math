import type { SupabaseClient } from '@supabase/supabase-js';
import { isModerationColumnError } from '@/lib/bot/moderation';
import { type BotRole, type ModerationStatus, ensureMember, getMember, getModerationInfo, isBotRole } from './roles';

// ---------------------------------------------------------------------------
// Продуктовые доступы (user_accesses)
//
// bot_members.role отвечает на вопрос «КТО этот пользователь»,
// user_accesses — «КАКИМИ ПРОДУКТАМИ он пользуется». Это разные сущности:
// один пользователь может одновременно иметь несколько активных доступов
// (например, course + individual). Роль для определения продукта не
// используется; существующая логика student не меняется.
// ---------------------------------------------------------------------------

export const ACCESS_PRODUCTS = ['course', 'individual', 'group'] as const;
export type AccessProduct = (typeof ACCESS_PRODUCTS)[number];

export const ACCESS_PRODUCT_LABELS: Record<AccessProduct, string> = {
  course: 'Курс',
  individual: 'Индивидуальные занятия',
  group: 'Групповые занятия',
};

export type AccessStatus = 'active' | 'expired' | 'cancelled';

export type UserAccessRow = {
  id: number;
  telegram_id: number;
  product: AccessProduct;
  status: AccessStatus;
  started_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export function isAccessProduct(value: unknown): value is AccessProduct {
  return (ACCESS_PRODUCTS as readonly string[]).includes(String(value));
}

// 42P01 — таблицы нет, PGRST205 — PostgREST ещё не подхватил схему.
// Только реальные случаи «миграция не применена», без маскировки других ошибок.
export function isAccessTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return message.includes('user_accesses') && (
    message.includes('does not exist') || message.includes('Could not find')
  );
}

// Доступ действующий, если status = 'active' и срок не прошёл.
// expires_at = null — бессрочный доступ.
export function isAccessActive(row: Pick<UserAccessRow, 'status' | 'expires_at'>, now: Date = new Date()): boolean {
  if (row.status !== 'active') return false;
  if (!row.expires_at) return true;
  return new Date(row.expires_at).getTime() > now.getTime();
}

// Все записи доступов пользователя (любой статус, история включительно).
export async function getUserAccesses(admin: SupabaseClient, telegramId: number): Promise<UserAccessRow[]> {
  const { data, error } = await admin
    .from('user_accesses')
    .select('id, telegram_id, product, status, started_at, expires_at, created_at, updated_at')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as UserAccessRow[];
}

// Только действующие продукты пользователя: status = 'active' и срок не истёк.
export async function getActiveProducts(admin: SupabaseClient, telegramId: number): Promise<AccessProduct[]> {
  const rows = await getUserAccesses(admin, telegramId);
  return rows.filter((row) => isAccessActive(row)).map((row) => row.product);
}

export async function hasActiveAccess(
  admin: SupabaseClient,
  telegramId: number,
  product: AccessProduct,
): Promise<boolean> {
  const { data, error } = await admin
    .from('user_accesses')
    .select('status, expires_at')
    .eq('telegram_id', telegramId)
    .eq('product', product)
    .maybeSingle();
  if (error) throw error;
  return data ? isAccessActive(data as Pick<UserAccessRow, 'status' | 'expires_at'>) : false;
}

// Выдаёт доступ: новая запись или продление/перевыдача существующей
// (unique-индекс telegram_id + product). expires_at = null — бессрочный.
export async function grantAccess(
  admin: SupabaseClient,
  telegramId: number,
  product: AccessProduct,
  options: { startedAt?: string; expiresAt?: string | null } = {},
): Promise<UserAccessRow> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('user_accesses')
    .upsert(
      {
        telegram_id: telegramId,
        product,
        status: 'active',
        started_at: options.startedAt ?? now,
        expires_at: options.expiresAt ?? null,
        updated_at: now,
      },
      { onConflict: 'telegram_id,product' },
    )
    .select('id, telegram_id, product, status, started_at, expires_at, created_at, updated_at')
    .single();
  if (error) throw error;
  return data as UserAccessRow;
}

// Отмена доступа: запись сохраняется как cancelled (история не теряется).
// Возвращает false, если отменять нечего.
export async function revokeAccess(
  admin: SupabaseClient,
  telegramId: number,
  product: AccessProduct,
): Promise<boolean> {
  const { data, error } = await admin
    .from('user_accesses')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('telegram_id', telegramId)
    .eq('product', product)
    .neq('status', 'cancelled')
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

// Служебный перевод просроченных доступов в expired: status = 'active',
// но expires_at уже в прошлом. Возвращает количество затронутых записей.
export async function expireAccesses(
  admin: SupabaseClient,
  options: { telegramId?: number; now?: Date } = {},
): Promise<number> {
  const nowIso = (options.now ?? new Date()).toISOString();
  let query = admin
    .from('user_accesses')
    .update({ status: 'expired', updated_at: nowIso })
    .eq('status', 'active')
    .not('expires_at', 'is', null)
    .lte('expires_at', nowIso)
    .select('id');
  if (options.telegramId !== undefined) query = query.eq('telegram_id', options.telegramId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).length;
}

// ---------------------------------------------------------------------------
// Единый контекст пользователя — основа будущего динамического меню
// ---------------------------------------------------------------------------

export type UserContext = {
  telegramId: number;
  role: BotRole;
  // Тест-маска (только для role = 'test'); у остальных ролей всегда null.
  viewRole: BotRole | null;
  moderationStatus: ModerationStatus;
  accesses: Record<AccessProduct, boolean>;
};

// Собирает роль и статус модерации из bot_members и продуктовые доступы
// из user_accesses одним вызовом. Пользователя нет в bot_members — null.
// Таблица доступов ещё не применена — доступы считаются отсутствующими
// (бот продолжает работать, как до миграции).
export async function getUserContext(admin: SupabaseClient, telegramId: number): Promise<UserContext | null> {
  let role: string | null = null;
  let moderationStatus: ModerationStatus = 'active';

  try {
    const moderation = await getModerationInfo(admin, telegramId);
    if (!moderation) return null;
    role = moderation.role;
    moderationStatus = moderation.moderationStatus;
  } catch (error) {
    // Колонки модерации ещё нет (bot_moderation.sql не применена):
    // роль берём напрямую, статус считаем активным.
    if (!isModerationColumnError(error)) throw error;
    const member = await getMember(admin, telegramId);
    if (!member) return null;
    role = member.role;
  }

  // Тест-маска нужна только тестерам: один лёгкий доп. запрос только для role = 'test'.
  let viewRole: BotRole | null = null;
  if (role === 'test') {
    const member = await ensureMember(admin, telegramId, {});
    viewRole = member.viewRole;
  }

  let products: AccessProduct[] = [];
  try {
    products = await getActiveProducts(admin, telegramId);
  } catch (error) {
    if (!isAccessTableError(error)) throw error;
    console.error('Таблица user_accesses не применена (supabase/user_accesses.sql):', error);
  }

  const accesses: Record<AccessProduct, boolean> = {
    course: products.includes('course'),
    individual: products.includes('individual'),
    group: products.includes('group'),
  };

  return {
    telegramId,
    role: isBotRole(role) ? role : 'guest',
    viewRole,
    moderationStatus,
    accesses,
  };
}
