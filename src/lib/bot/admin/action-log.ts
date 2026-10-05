import type { SupabaseClient } from '@supabase/supabase-js';

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
};

export function adminActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
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

export async function listAdminActionLog(
  admin: SupabaseClient,
  page: number,
  perPage = 8,
): Promise<{ rows: AdminActionLogRow[]; total: number }> {
  const from = page * perPage;
  const { data, error, count } = await admin
    .from('admin_action_log')
    .select(
      'id, created_at, actor_telegram_id, action, entity_type, entity_id, target_telegram_id, detail',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, from + perPage - 1);
  if (error) {
    if (isActionLogTableError(error)) return { rows: [], total: 0 };
    throw error;
  }
  return { rows: (data ?? []) as unknown as AdminActionLogRow[], total: count ?? 0 };
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
  if (row.entity_id) parts.push(`#${row.entity_id}`);
  if (row.target_telegram_id) parts.push(`→ ${row.target_telegram_id}`);
  return parts.join(' · ');
}
