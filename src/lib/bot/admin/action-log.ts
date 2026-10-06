import type { SupabaseClient } from '@supabase/supabase-js';
import { formatEventDisplayId, formatShortDisplayId } from '@/lib/displayId';

export type AdminActionLogRow = {
  id: string;
  created_at: string;
  actor_telegram_id: number;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  target_telegram_id: number | null;
  detail: Record<string, unknown> | null;
};

export type AdminActionInput = {
  actorTelegramId: number;
  action: string;
  entityType?: string;
  entityId?: string | number;
  targetTelegramId?: number | null;
  detail?: Record<string, unknown>;
};

const ACTION_LABELS: Record<string, string> = {
  'lead.status': '📨 Статус заявки',
  'lead.assignee': '📨 Ответственный заявки',
  'package.adjust': '📦 Остаток пакета',
  'package.sync': '📦 Пересчёт пакета',
  'lesson.cancel': '📅 Отмена занятия',
  'lesson.reschedule': '📅 Перенос занятия',
  'purchase.approve': '💳 Оплата подтверждена',
  'purchase.reject': '💳 Оплата отклонена',
  'user.role': '🎭 Роль пользователя',
  'user.extra_add': '➕ Доп. роль',
  'user.extra_remove': '➖ Доп. роль',
  'broadcast.schedule': '📢 Запланирована рассылка',
  'broadcast.send': '📢 Запущена рассылка',
  'broadcast.cancel': '📢 Отменена рассылка',
  'broadcast.complete': '📢 Рассылка завершена',
  'violation.recorded': '💬 Зафиксировано нарушение',
  'problem.resolve': '✅ Проблема решена',
  'problem.create': '🚨 Создана проблема',
};

/** Подписи для ленты на главной (без технических action-ключей). */
const ACTION_FEED_LABELS: Record<string, string> = {
  'lead.status': '📝 Изменён статус',
  'lead.assignee': '📨 Назначен ответственный',
  'package.adjust': '📦 Изменён пакет',
  'package.sync': '📦 Пересчёт пакета',
  'lesson.cancel': '📅 Отмена занятия',
  'lesson.reschedule': '📅 Перенос занятия',
  'purchase.approve': '💳 Получена оплата',
  'purchase.reject': '💳 Оплата отклонена',
  'user.role': '🎭 Роль пользователя',
  'user.extra_add': '➕ Доп. роль',
  'user.extra_remove': '➖ Доп. роль',
  'broadcast.schedule': '📢 Запланирована рассылка',
  'broadcast.send': '📢 Запущена рассылка',
  'broadcast.cancel': '📢 Отменена рассылка',
  'broadcast.complete': '📢 Рассылка завершена',
  'violation.recorded': '💬 Нарушение переписки',
  'problem.resolve': '✅ Проблема решена',
  'problem.create': '🚨 Создана проблема',
};

export function adminActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function adminActionFeedLabel(action: string): string {
  return ACTION_FEED_LABELS[action] ?? adminActionLabel(action);
}

export type ActionFeedEntry = {
  time: string;
  title: string;
  subtitle: string;
  openCallback: string | null;
  eventDisplayId: string | null;
};

export type ActionLogPeriod = 'all' | 'today' | '7d' | '30d';

export function normalizeActionLogPeriod(raw?: string): ActionLogPeriod {
  const allowed: ActionLogPeriod[] = ['all', 'today', '7d', '30d'];
  return allowed.includes(raw as ActionLogPeriod) ? (raw as ActionLogPeriod) : 'all';
}

function periodFromIso(period: ActionLogPeriod): string | null {
  if (period === 'all') return null;
  const msDay = 86400000;
  const mskOffset = 3 * 3600000;
  const now = Date.now();
  const mskMidnight = Math.floor((now + mskOffset) / msDay) * msDay - mskOffset;
  if (period === 'today') return new Date(mskMidnight).toISOString();
  if (period === '7d') return new Date(mskMidnight - 6 * msDay).toISOString();
  return new Date(mskMidnight - 29 * msDay).toISOString();
}

export function buildActionFeedEntry(row: AdminActionLogRow): ActionFeedEntry {
  const time = new Date(row.created_at).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  });
  const title = adminActionFeedLabel(row.action);
  const shortId = formatShortDisplayId(row.entity_id);
  let subtitle = '';
  let openCallback: string | null = null;

  if (row.action.startsWith('lead.') && row.entity_id) {
    subtitle = shortId ? `Заявка ${shortId}` : 'Заявка';
    openCallback = `al:l:${row.entity_id}:n:0:a`;
  } else if (row.action.startsWith('purchase.') && row.entity_id) {
    subtitle = shortId ? `Оплата ${shortId}` : 'Оплата';
    openCallback = `ap:l:${row.entity_id}:p:0`;
  } else if (row.action.startsWith('lesson.') && row.entity_id) {
    subtitle = shortId ? `Занятие ${shortId}` : 'Занятие';
    const lessonId = Number(row.entity_id);
    if (Number.isFinite(lessonId)) openCallback = `ae:ls:l:${lessonId}:0:0`;
  } else if (shortId) {
    subtitle = shortId;
  } else if (row.target_telegram_id) {
    subtitle = `Пользователь ${row.target_telegram_id}`;
  } else {
    subtitle = 'Событие';
  }

  return {
    time,
    title,
    subtitle,
    openCallback,
    eventDisplayId: formatEventDisplayId(row.id),
  };
}

export async function getAdminActionLogById(
  admin: SupabaseClient,
  id: string,
): Promise<AdminActionLogRow | null> {
  const { data, error } = await admin
    .from('admin_action_log')
    .select(
      'id, created_at, actor_telegram_id, action, entity_type, entity_id, target_telegram_id, detail',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isActionLogTableError(error)) return null;
    throw error;
  }
  return (data as AdminActionLogRow | null) ?? null;
}

export async function searchAdminActionLog(
  admin: SupabaseClient,
  query: string,
  limit = 12,
): Promise<AdminActionLogRow[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const { data, error } = await admin
    .from('admin_action_log')
    .select(
      'id, created_at, actor_telegram_id, action, entity_type, entity_id, target_telegram_id, detail',
    )
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    if (isActionLogTableError(error)) return [];
    throw error;
  }

  const rows = (data ?? []) as AdminActionLogRow[];
  return rows
    .filter((row) => {
      const hay = [
        row.action,
        row.entity_id ?? '',
        row.entity_type ?? '',
        row.id,
        formatEventDisplayId(row.id) ?? '',
        JSON.stringify(row.detail ?? {}),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    })
    .slice(0, limit);
}

export function isActionLogTableError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  const code = String((error as { code?: string })?.code ?? '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('admin_action_log')
  );
}

export async function logAdminAction(
  admin: SupabaseClient,
  input: AdminActionInput,
): Promise<void> {
  try {
    const { error } = await admin.from('admin_action_log').insert({
      actor_telegram_id: input.actorTelegramId,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId != null ? String(input.entityId) : null,
      target_telegram_id: input.targetTelegramId ?? null,
      detail: input.detail ?? null,
    });
    if (error) throw error;
  } catch (error) {
    if (!isActionLogTableError(error)) {
      console.error('[admin_action_log]', error);
    }
  }
}

export type ActionLogCategory = 'all' | 'people' | 'finance' | 'lessons' | 'leads' | 'system';

const CATEGORY_ACTION_PREFIXES: Record<Exclude<ActionLogCategory, 'all'>, string[]> = {
  people: ['user.'],
  finance: ['purchase.', 'package.'],
  lessons: ['lesson.'],
  leads: ['lead.'],
  system: [],
};

export function normalizeActionLogCategory(raw?: string): ActionLogCategory {
  const cats: ActionLogCategory[] = ['all', 'people', 'finance', 'lessons', 'leads', 'system'];
  return cats.includes(raw as ActionLogCategory) ? (raw as ActionLogCategory) : 'all';
}

function actionMatchesCategory(action: string, category: ActionLogCategory): boolean {
  if (category === 'all') return true;
  if (category === 'system') {
    const known = Object.values(CATEGORY_ACTION_PREFIXES).flat();
    return !known.some((p) => action.startsWith(p));
  }
  return CATEGORY_ACTION_PREFIXES[category].some((p) => action.startsWith(p));
}

export async function countAdminActionLogToday(admin: SupabaseClient): Promise<number> {
  const msDay = 86400000;
  const mskOffset = 3 * 3600000;
  const now = Date.now();
  const mskMidnight = Math.floor((now + mskOffset) / msDay) * msDay - mskOffset;
  const fromIso = new Date(mskMidnight).toISOString();
  const { count, error } = await admin
    .from('admin_action_log')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', fromIso);
  if (error) {
    if (isActionLogTableError(error)) return 0;
    throw error;
  }
  return count ?? 0;
}

export async function listAdminActionLog(
  admin: SupabaseClient,
  page: number,
  perPage = 8,
  category: ActionLogCategory = 'all',
  period: ActionLogPeriod = 'all',
): Promise<{ rows: AdminActionLogRow[]; total: number }> {
  const fromIso = periodFromIso(period);

  if (category === 'all') {
    const from = page * perPage;
    let builder = admin
      .from('admin_action_log')
      .select(
        'id, created_at, actor_telegram_id, action, entity_type, entity_id, target_telegram_id, detail',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false });
    if (fromIso) builder = builder.gte('created_at', fromIso);
    const { data, error, count } = await builder.range(from, from + perPage - 1);
    if (error) {
      if (isActionLogTableError(error)) return { rows: [], total: 0 };
      throw error;
    }
    return { rows: (data ?? []) as unknown as AdminActionLogRow[], total: count ?? 0 };
  }

  const fetchSize = 200;
  const filtered: AdminActionLogRow[] = [];
  for (let offset = 0; ; offset += fetchSize) {
    let builder = admin
      .from('admin_action_log')
      .select(
        'id, created_at, actor_telegram_id, action, entity_type, entity_id, target_telegram_id, detail',
      )
      .order('created_at', { ascending: false });
    if (fromIso) builder = builder.gte('created_at', fromIso);
    const { data, error } = await builder.range(offset, offset + fetchSize - 1);
    if (error) {
      if (isActionLogTableError(error)) return { rows: [], total: 0 };
      throw error;
    }
    const batch = (data ?? []) as unknown as AdminActionLogRow[];
    for (const row of batch) {
      if (actionMatchesCategory(row.action, category)) filtered.push(row);
    }
    if (batch.length < fetchSize) break;
  }
  const from = page * perPage;
  return {
    rows: filtered.slice(from, from + perPage),
    total: filtered.length,
  };
}

export function formatActionLogLine(row: AdminActionLogRow): string {
  const when = new Date(row.created_at).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = [adminActionLabel(row.action), when];
  const shortId = formatShortDisplayId(row.entity_id);
  if (shortId) parts.push(shortId);
  if (row.target_telegram_id) parts.push(`→ ${row.target_telegram_id}`);
  return parts.join(' · ');
}
