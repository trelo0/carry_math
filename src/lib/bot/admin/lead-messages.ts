import type { SupabaseClient } from '@supabase/supabase-js';

export type LeadMessageDirection = 'client_to_admin' | 'admin_to_client';

export type LeadMessageRow = {
  id: number;
  lead_id: string;
  direction: LeadMessageDirection;
  sender_telegram_id: number | null;
  telegram_message_id: number | null;
  body: string | null;
  message_type: string;
  attachment: unknown;
  created_at: string;
};

export function isLeadMessagesTableError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  const code = String((error as { code?: string })?.code ?? '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('lead_messages')
  );
}

export async function insertLeadMessage(
  admin: SupabaseClient,
  row: {
    leadId: string;
    direction: LeadMessageDirection;
    senderTelegramId?: number | null;
    telegramMessageId?: number | null;
    body?: string | null;
    messageType?: string;
    attachment?: unknown;
  },
): Promise<boolean> {
  const { error } = await admin.from('lead_messages').insert({
    lead_id: row.leadId,
    direction: row.direction,
    sender_telegram_id: row.senderTelegramId ?? null,
    telegram_message_id: row.telegramMessageId ?? null,
    body: row.body ?? null,
    message_type: row.messageType ?? 'text',
    attachment: row.attachment ?? null,
  });
  if (error) {
    if (isLeadMessagesTableError(error)) return false;
    throw error;
  }
  return true;
}

export async function listLeadMessages(
  admin: SupabaseClient,
  leadId: string,
  opts: { limit: number; beforeId?: number },
): Promise<LeadMessageRow[]> {
  let query = admin
    .from('lead_messages')
    .select(
      'id, lead_id, direction, sender_telegram_id, telegram_message_id, body, message_type, attachment, created_at',
    )
    .eq('lead_id', leadId)
    .order('id', { ascending: false })
    .limit(opts.limit);
  if (opts.beforeId != null) query = query.lt('id', opts.beforeId);
  const { data, error } = await query;
  if (error) {
    if (isLeadMessagesTableError(error)) return [];
    throw error;
  }
  return (data ?? []) as LeadMessageRow[];
}
