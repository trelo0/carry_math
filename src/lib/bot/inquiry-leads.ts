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

export type InquiryFirstAttachment = {
  fileId: string;
  kind: 'photo' | 'document' | 'voice';
  fileName?: string;
  mimeType?: string;
};

export async function createInquiryLead(
  admin: SupabaseClient,
  telegramId: number,
  kind: InquiryKind,
  firstMessage: string,
  options?: { forceNew?: boolean; firstAttachment?: InquiryFirstAttachment },
): Promise<LeadRow | null> {
  const existing = options?.forceNew ? null : await findOpenInquiryLead(admin, telegramId, kind);
  if (existing) {
    await insertLeadMessage(admin, {
      leadId: existing.id,
      direction: 'client_to_admin',
      senderTelegramId: telegramId,
      body: firstMessage || null,
      messageType: options?.firstAttachment?.kind ?? 'text',
      attachment: options?.firstAttachment
        ? {
            file_id: options.firstAttachment.fileId,
            kind: options.firstAttachment.kind,
            file_name: options.firstAttachment.fileName,
            mime_type: options.firstAttachment.mimeType,
          }
        : undefined,
    });
    return existing;
  }

  const { name, contact } = await memberContact(admin, telegramId);
  const insertRow: Record<string, unknown> = {
    name,
    contact,
    comment: firstMessage.slice(0, 2000),
    service: kind === 'application' ? 'Заявка' : 'Вопрос админу',
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
          body: firstMessage || null,
          messageType: options?.firstAttachment?.kind ?? 'text',
          attachment: options?.firstAttachment
            ? {
                file_id: options.firstAttachment.fileId,
                kind: options.firstAttachment.kind,
                file_name: options.firstAttachment.fileName,
                mime_type: options.firstAttachment.mimeType,
              }
            : undefined,
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
      body: firstMessage || null,
      messageType: options?.firstAttachment?.kind ?? 'text',
      attachment: options?.firstAttachment
        ? {
            file_id: options.firstAttachment.fileId,
            kind: options.firstAttachment.kind,
            file_name: options.firstAttachment.fileName,
            mime_type: options.firstAttachment.mimeType,
          }
        : undefined,
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
  limit = 30,
): Promise<LeadRow[]> {
  const { data, error } = await admin
    .from('leads')
    .select(LEAD_SELECT_COLUMNS)
    .eq('client_telegram_id', telegramId)
    .in('inquiry_kind', kinds)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isInquiryKindColumnError(error)) return [];
    throw error;
  }
  return (data ?? []) as LeadRow[];
}

const ARCHIVE_INQUIRY_KINDS: InquiryKind[] = ['application', 'student_question', 'guest_question'];

/** Все обращения ученика в leads (включая заявки на обучение) + legacy по comment. */
export async function listClientLeadsForAppealsArchive(
  admin: SupabaseClient,
  telegramId: number,
  limit = 40,
): Promise<LeadRow[]> {
  const byId = new Map<string, LeadRow>();

  const modern = await listClientInquiryLeads(admin, telegramId, ARCHIVE_INQUIRY_KINDS, limit);
  for (const row of modern) byId.set(row.id, row);

  try {
    const tag = `telegram_id:${telegramId}`;
    const { data, error } = await admin
      .from('leads')
      .select(LEAD_SELECT_COLUMNS)
      .ilike('comment', `%${tag}%`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!error) {
      for (const row of (data ?? []) as LeadRow[]) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
    }
  } catch {
    /* optional */
  }

  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
}

export function leadArchiveKindLabel(row: LeadRow): string {
  const kind = row.inquiry_kind;
  if (kind === 'application') return '📚 Заявка';
  if (kind === 'guest_question' || kind === 'student_question') return '🛡 Вопрос админу';
  const service = (row.service ?? '').toLowerCase();
  if (service.includes('заявк') || service.includes('курс')) return '📚 Заявка';
  return '🛡 Обращение';
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
