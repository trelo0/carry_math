import type { SupabaseClient } from '@supabase/supabase-js';
import { insertLeadMessage } from './admin/lead-messages';
import { logLeadEvent } from './admin/lead-events';
import { LEAD_SELECT_COLUMNS, type LeadRow } from './admin/leads';

export type InquiryKind = 'application' | 'student_question' | 'guest_question';

export function isInquiryKindColumnError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  return message.includes('inquiry_kind') || message.includes('client_telegram_id');
}

async function memberContact(admin: SupabaseClient, telegramId: number): Promise<{ name: string; contact: string }> {
  const [{ data: member }, { data: link }] = await Promise.all([
    admin.from('bot_members').select('full_name, phone').eq('telegram_id', telegramId).maybeSingle(),
    admin.from('telegram_links').select('phone').eq('telegram_id', telegramId).maybeSingle(),
  ]);
  const phone = (link?.phone as string | undefined) ?? (member?.phone as string | undefined);
  const name = (member?.full_name as string | undefined)?.trim() || 'Клиент';
  const contact = phone?.trim() || `Telegram ${telegramId}`;
  return { name, contact };
}

export async function findOpenInquiryLead(
  admin: SupabaseClient,
  telegramId: number,
  kind: InquiryKind,
): Promise<LeadRow | null> {
  const { data, error } = await admin
    .from('leads')
    .select(LEAD_SELECT_COLUMNS)
    .eq('client_telegram_id', telegramId)
    .eq('inquiry_kind', kind)
    .in('status', ['new', 'awaiting_reply', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isInquiryKindColumnError(error)) {
      const tag = `telegram_id:${telegramId}`;
      const legacy = await admin
        .from('leads')
        .select(LEAD_SELECT_COLUMNS)
        .ilike('comment', `%${tag}%`)
        .in('status', ['new', 'awaiting_reply', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (legacy.error) throw legacy.error;
      return (legacy.data as LeadRow | null) ?? null;
    }
    throw error;
  }
  const row = data as LeadRow | null;
  if (!row) return null;
  if ('inquiry_kind' in row && (row as LeadRow & { inquiry_kind?: string }).inquiry_kind !== kind) {
    return null;
  }
  return row;
}

export async function createInquiryLead(
  admin: SupabaseClient,
  telegramId: number,
  kind: InquiryKind,
  firstMessage: string,
): Promise<LeadRow | null> {
  const existing = await findOpenInquiryLead(admin, telegramId, kind);
  if (existing) {
    await insertLeadMessage(admin, {
      leadId: existing.id,
      direction: 'client_to_admin',
      senderTelegramId: telegramId,
      body: firstMessage,
    });
    return existing;
  }

  const { name, contact } = await memberContact(admin, telegramId);
  const insertRow: Record<string, unknown> = {
    name,
    contact,
    comment: firstMessage.slice(0, 2000),
    service: kind === 'guest_question' ? 'Вопрос гостя' : 'Вопрос ученика',
    source: 'telegram_bot',
    status: 'new',
    inquiry_kind: kind,
    client_telegram_id: telegramId,
  };

  const { data, error } = await admin.from('leads').insert(insertRow).select(LEAD_SELECT_COLUMNS).maybeSingle();
  if (error) {
    if (isInquiryKindColumnError(error)) {
      const fallback = await admin
        .from('leads')
        .insert({
          name,
          contact,
          comment: `${firstMessage.slice(0, 1500)}\n\ntelegram_id:${telegramId}`,
          service: insertRow.service,
          source: 'telegram_bot',
        })
        .select(LEAD_SELECT_COLUMNS)
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      const row = fallback.data as LeadRow | null;
      if (row) {
        await insertLeadMessage(admin, {
          leadId: row.id,
          direction: 'client_to_admin',
          senderTelegramId: telegramId,
          body: firstMessage,
        });
      }
      return row;
    }
    throw error;
  }

  const row = data as LeadRow | null;
  if (row) {
    await insertLeadMessage(admin, {
      leadId: row.id,
      direction: 'client_to_admin',
      senderTelegramId: telegramId,
      body: firstMessage,
    });
    try {
      await logLeadEvent(admin, {
        leadId: row.id,
        eventType: 'inquiry_created',
        actorTelegramId: telegramId,
        detail: { inquiry_kind: kind },
      });
    } catch {
      /* optional */
    }
  }
  return row;
}

export async function listClientInquiryLeads(
  admin: SupabaseClient,
  telegramId: number,
  kinds: InquiryKind[],
): Promise<LeadRow[]> {
  const { data, error } = await admin
    .from('leads')
    .select(LEAD_SELECT_COLUMNS)
    .eq('client_telegram_id', telegramId)
    .in('inquiry_kind', kinds)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) {
    if (isInquiryKindColumnError(error)) return [];
    throw error;
  }
  return (data ?? []) as LeadRow[];
}

export async function countOpenQuestionLeads(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .in('inquiry_kind', ['student_question', 'guest_question'])
    .in('status', ['new', 'awaiting_reply', 'in_progress']);
  if (error) {
    if (isInquiryKindColumnError(error)) return 0;
    throw error;
  }
  return count ?? 0;
}
