import type { SupabaseClient } from '@supabase/supabase-js';
import { insertLeadMessage } from './lead-messages';
import { logLeadEvent } from './lead-events';
import { LEAD_SELECT_COLUMNS, parseLeadTelegramId, setLeadStatus, type LeadRow } from './leads';
import { isInquiryKindColumnError } from '../inquiry-leads';

function isApplicationLead(row: { inquiry_kind?: string | null }): boolean {
  const kind = row.inquiry_kind;
  return !kind || kind === 'application';
}

export async function findOpenLeadForTelegram(
  admin: SupabaseClient,
  telegramId: number,
): Promise<LeadRow | null> {
  const { data, error } = await admin
    .from('leads')
    .select(LEAD_SELECT_COLUMNS)
    .eq('client_telegram_id', telegramId)
    .in('status', ['new', 'awaiting_reply', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    if (!isInquiryKindColumnError(error)) throw error;
    return findOpenLeadForTelegramLegacy(admin, telegramId);
  }

  for (const row of data ?? []) {
    if (isApplicationLead(row as { inquiry_kind?: string | null })) {
      return row as LeadRow;
    }
  }
  return null;
}

async function findOpenLeadForTelegramLegacy(
  admin: SupabaseClient,
  telegramId: number,
): Promise<LeadRow | null> {
  const tag = `telegram_id:${telegramId}`;
  const { data, error } = await admin
    .from('leads')
    .select(LEAD_SELECT_COLUMNS)
    .ilike('comment', `%${tag}%`)
    .in('status', ['new', 'awaiting_reply', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) throw error;
  for (const row of data ?? []) {
    const service = (row as LeadRow).service ?? '';
    if (service.includes('Вопрос')) continue;
    if (parseLeadTelegramId((row as LeadRow).comment) !== telegramId) continue;
    return row as LeadRow;
  }
  return null;
}

export async function recordInboundClientMedia(
  admin: SupabaseClient,
  telegramId: number,
  input: {
    messageType: string;
    body?: string | null;
    telegramMessageId?: number;
    attachment: Record<string, unknown>;
  },
): Promise<boolean> {
  const lead = await findOpenLeadForTelegram(admin, telegramId);
  if (!lead) return false;
  if (parseLeadTelegramId(lead.comment) !== telegramId && lead.client_telegram_id !== telegramId) {
    return false;
  }

  await insertLeadMessage(admin, {
    leadId: lead.id,
    direction: 'client_to_admin',
    senderTelegramId: telegramId,
    telegramMessageId: input.telegramMessageId ?? null,
    body: input.body ?? null,
    messageType: input.messageType,
    attachment: input.attachment,
  });
  await logLeadEvent(admin, {
    leadId: lead.id,
    eventType: 'client_message',
    actorTelegramId: telegramId,
    detail: { message_type: input.messageType },
  });
  await setLeadStatus(admin, lead.id, 'awaiting_reply', null);
  return true;
}

export async function recordInboundClientMessage(
  admin: SupabaseClient,
  telegramId: number,
  body: string,
  telegramMessageId?: number,
): Promise<boolean> {
  const trimmed = body.trim();
  if (!trimmed) return false;
  const lead = await findOpenLeadForTelegram(admin, telegramId);
  if (!lead) return false;
  if (parseLeadTelegramId(lead.comment) !== telegramId && lead.client_telegram_id !== telegramId) {
    return false;
  }

  await insertLeadMessage(admin, {
    leadId: lead.id,
    direction: 'client_to_admin',
    senderTelegramId: telegramId,
    telegramMessageId: telegramMessageId ?? null,
    body: trimmed,
  });
  await logLeadEvent(admin, {
    leadId: lead.id,
    eventType: 'client_message',
    actorTelegramId: telegramId,
    detail: { length: trimmed.length },
  });
  const st = lead.status ?? 'new';
  if (st === 'new' || st === 'awaiting_reply') {
    await setLeadStatus(admin, lead.id, 'awaiting_reply', null);
  }
  return true;
}
