import type { SupabaseClient } from '@supabase/supabase-js';

export type LeadEventRow = {
  id: number;
  lead_id: string;
  event_type: string;
  detail: Record<string, unknown> | null;
  actor_telegram_id: number | null;
  created_at: string;
};

const EVENT_LABELS: Record<string, string> = {
  lead_created: '📨 Создана заявка',
  admin_reply: '💬 Администратор ответил клиенту',
  client_message: '💬 Сообщение клиента',
  trial_scheduled: '📅 Оформлено пробное',
  trial_payment_requested: '💳 Запрошена оплата',
  trial_payment_skipped: '➡️ Оплата не запрашивалась',
  trial_paid: '💰 Оплата получена',
  trial_confirmed: '✅ Пробное подтверждено',
  trial_rescheduled: '🔄 Пробное перенесено',
  trial_cancelled: '❌ Пробное отменено',
  trial_conducted: '🎓 Пробное проведено',
  outcome_continues: '✅ Клиент продолжает обучение',
  outcome_thinking: '🤔 Клиент думает',
  outcome_declined: '❌ Клиент не продолжает',
  lead_closed: '🟢 Заявка закрыта',
  lead_reopened: '🔄 Заявка возвращена в работу',
  enrollment_course: '🎓 Зачисление на курс',
  enrollment_purchase_request: '💳 Заявка на пакет из оформления',
  enrollment_completed: '✅ Оформление ученика завершено',
};

export function isLeadEventsTableError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  return message.includes('lead_events');
}

export async function logLeadEvent(
  admin: SupabaseClient,
  input: {
    leadId: string;
    eventType: string;
    actorTelegramId?: number | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await admin.from('lead_events').insert({
    lead_id: input.leadId,
    event_type: input.eventType,
    actor_telegram_id: input.actorTelegramId ?? null,
    detail: input.detail ?? null,
  });
  if (error && !isLeadEventsTableError(error)) throw error;
}

export async function listLeadEvents(
  admin: SupabaseClient,
  leadId: string,
  limit = 12,
): Promise<LeadEventRow[]> {
  const { data, error } = await admin
    .from('lead_events')
    .select('id, lead_id, event_type, detail, actor_telegram_id, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isLeadEventsTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as LeadEventRow[];
}

export function formatLeadEventLine(row: LeadEventRow, formatDateTime: (iso: string) => string): string {
  const label = EVENT_LABELS[row.event_type] ?? row.event_type;
  return `${formatDateTime(row.created_at)}\n${label}`;
}
