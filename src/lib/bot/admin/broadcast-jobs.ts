import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import type { AdminPayload, BroadcastAttachmentKind } from './core';
import { isBroadcastTableError } from './broadcasts';

export const BROADCAST_ASYNC_THRESHOLD = 25;
export const BROADCAST_CHUNK_SIZE = 15;
const BROADCAST_DELAY_MS = 50;

export type StoredBroadcastPayload = {
  audience?: string;
  audienceTitle?: string;
  broadcastText?: string;
  attachmentKind?: string;
  fileId?: string;
  fileName?: string;
  buttonText?: string;
  buttonUrl?: string;
};

export type BroadcastJobRow = {
  id: number;
  status: string;
  scheduled_at: string | null;
  audience_title: string;
  title: string | null;
  recipients: number;
  delivered: number;
  failed: number;
  errors: unknown;
  payload: StoredBroadcastPayload | null;
  pending_chat_ids: number[];
  admin_telegram_id: number;
  admin_notify_chat_id: number | null;
  text_preview: string;
};

function isPhase2ColumnError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  return message.includes('status') || message.includes('pending_chat_ids') || message.includes('payload');
}

export async function broadcastJobsAvailable(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.from('bot_broadcasts').select('status, payload, pending_chat_ids').limit(1);
  if (!error) return true;
  if (isBroadcastTableError(error)) return false;
  if (isPhase2ColumnError(error)) return false;
  throw error;
}

export async function countBroadcastsByStatus(
  admin: SupabaseClient,
  status: string,
): Promise<number> {
  if (!(await broadcastJobsAvailable(admin))) return 0;
  const { count, error } = await admin
    .from('bot_broadcasts')
    .select('id', { count: 'exact', head: true })
    .eq('status', status);
  if (error) {
    if (isBroadcastTableError(error) || isPhase2ColumnError(error)) return 0;
    throw error;
  }
  return count ?? 0;
}

export async function listScheduledBroadcasts(
  admin: SupabaseClient,
  limit = 10,
): Promise<BroadcastJobRow[]> {
  if (!(await broadcastJobsAvailable(admin))) return [];
  const { data, error } = await admin
    .from('bot_broadcasts')
    .select(
      'id, status, scheduled_at, audience_title, title, recipients, delivered, failed, errors, payload, pending_chat_ids, admin_telegram_id, admin_notify_chat_id, text_preview',
    )
    .eq('status', 'scheduled')
    .order('scheduled_at', { ascending: true })
    .limit(limit);
  if (error) {
    if (isBroadcastTableError(error) || isPhase2ColumnError(error)) return [];
    throw error;
  }
  return (data ?? []).map(normalizeJobRow);
}

function normalizeJobRow(raw: Record<string, unknown>): BroadcastJobRow {
  const pending = raw.pending_chat_ids;
  return {
    id: raw.id as number,
    status: String(raw.status ?? 'completed'),
    scheduled_at: (raw.scheduled_at as string | null) ?? null,
    audience_title: String(raw.audience_title ?? ''),
    title: (raw.title as string | null) ?? null,
    recipients: Number(raw.recipients) || 0,
    delivered: Number(raw.delivered) || 0,
    failed: Number(raw.failed) || 0,
    errors: raw.errors,
    payload: (raw.payload as StoredBroadcastPayload | null) ?? null,
    pending_chat_ids: Array.isArray(pending) ? pending.map(Number).filter(Boolean) : [],
    admin_telegram_id: Number(raw.admin_telegram_id) || 0,
    admin_notify_chat_id: (raw.admin_notify_chat_id as number | null) ?? null,
    text_preview: String(raw.text_preview ?? ''),
  };
}

function payloadToStored(payload: AdminPayload): StoredBroadcastPayload {
  return {
    audience: payload.audience,
    audienceTitle: payload.audienceTitle,
    broadcastText: payload.broadcastText,
    attachmentKind: payload.attachmentKind,
    fileId: payload.fileId,
    fileName: payload.fileName,
    buttonText: payload.buttonText,
    buttonUrl: payload.buttonUrl,
  };
}

function storedToPayload(stored: StoredBroadcastPayload): AdminPayload {
  const kind = stored.attachmentKind;
  const attachmentKind =
    kind === 'photo' || kind === 'document' ? (kind as BroadcastAttachmentKind) : undefined;
  return {
    audience: stored.audience,
    audienceTitle: stored.audienceTitle,
    broadcastText: stored.broadcastText,
    attachmentKind,
    fileId: stored.fileId,
    fileName: stored.fileName,
    buttonText: stored.buttonText,
    buttonUrl: stored.buttonUrl,
  };
}

function broadcastUrlKeyboard(payload: AdminPayload) {
  if (!payload.buttonText || !payload.buttonUrl) return undefined;
  return { inline_keyboard: [[{ text: payload.buttonText, url: payload.buttonUrl }]] };
}

async function delay(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function sendOne(chatId: number, payload: AdminPayload): Promise<{ ok: boolean; reason?: string }> {
  const urlKeyboard = broadcastUrlKeyboard(payload);
  const attempts: Array<{ method: string; body: Record<string, unknown> }> = [];
  if (payload.fileId && payload.attachmentKind) {
    attempts.push({
      method: payload.attachmentKind === 'photo' ? 'sendPhoto' : 'sendDocument',
      body: {
        chat_id: chatId,
        [payload.attachmentKind === 'photo' ? 'photo' : 'document']: payload.fileId,
        caption: payload.broadcastText,
        ...(urlKeyboard ? { reply_markup: urlKeyboard } : {}),
      },
    });
  } else {
    attempts.push({
      method: 'sendMessage',
      body: { chat_id: chatId, text: payload.broadcastText, ...(urlKeyboard ? { reply_markup: urlKeyboard } : {}) },
    });
  }

  for (let attempt = 0; attempt < attempts.length; attempt += 1) {
    const current = attempts[attempt];
    const result = await telegramSend(current.method, current.body);
    if (result.ok) return { ok: true };
    const description = result.description ?? '';
    if (description.includes('Too Many Requests')) {
      const retryAfter = result.parameters?.retry_after ?? 3;
      await delay(retryAfter * 1000);
      attempts.push(current);
      continue;
    }
    if (description.includes('bot was blocked')) return { ok: false, reason: 'заблокировал бота' };
    if (
      description.includes('chat not found') ||
      description.includes('user is deactivated') ||
      description.includes('PEER_ID_INVALID')
    ) {
      return { ok: false, reason: 'недействительный chat_id' };
    }
    return { ok: false, reason: description };
  }
  return { ok: false, reason: 'превышено число попыток (429)' };
}

type BroadcastError = { name: string; reason: string };

export async function createBroadcastJob(
  admin: SupabaseClient,
  input: {
    adminTelegramId: number;
    adminNotifyChatId: number;
    audienceId: string;
    audienceTitle: string;
    title?: string;
    payload: AdminPayload;
    chatIds: number[];
    status: 'scheduled' | 'sending';
    scheduledAt?: string | null;
  },
): Promise<number | null> {
  if (!(await broadcastJobsAvailable(admin))) return null;

  const text = input.payload.broadcastText ?? '';
  const row = {
    admin_telegram_id: input.adminTelegramId,
    admin_notify_chat_id: input.adminNotifyChatId,
    audience_id: input.audienceId,
    audience_title: input.audienceTitle,
    title: input.title ?? input.audienceTitle,
    to_admins: input.audienceId === 'admin',
    text_preview: text.replace(/\n/g, ' ').slice(0, 160),
    has_attachment: Boolean(input.payload.fileId),
    has_button: Boolean(input.payload.buttonText && input.payload.buttonUrl),
    recipients: input.chatIds.length,
    delivered: 0,
    failed: 0,
    errors: [] as BroadcastError[],
    status: input.status,
    scheduled_at: input.scheduledAt ?? null,
    payload: payloadToStored(input.payload),
    pending_chat_ids: input.chatIds,
  };

  const { data, error } = await admin.from('bot_broadcasts').insert(row).select('id').single();
  if (error) {
    if (isBroadcastTableError(error) || isPhase2ColumnError(error)) return null;
    throw error;
  }
  return (data as { id: number } | null)?.id ?? null;
}

export async function updateScheduledBroadcastTime(
  admin: SupabaseClient,
  id: number,
  scheduledAt: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('bot_broadcasts')
    .update({ scheduled_at: scheduledAt, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function cancelScheduledBroadcast(admin: SupabaseClient, id: number): Promise<boolean> {
  const { data, error } = await admin
    .from('bot_broadcasts')
    .update({ status: 'cancelled', pending_chat_ids: [] })
    .eq('id', id)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function notifyAdminJobDone(row: BroadcastJobRow): Promise<void> {
  const chatId = row.admin_notify_chat_id;
  if (!chatId) return;
  const statsLine = `👥 Получателей: ${row.recipients}\n✅ Отправлено: ${row.delivered}\n⚠️ Не отправлено: ${row.failed}`;
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: ['📢 Рассылка завершена', '', statsLine, '', `ID: #BC-${row.id}`].join('\n'),
  });
}

export async function runBroadcastDispatch(
  admin: SupabaseClient,
  opts?: { maxMessages?: number },
): Promise<{ processed: number; completed: number }> {
  if (!(await broadcastJobsAvailable(admin))) return { processed: 0, completed: 0 };

  const maxMessages = opts?.maxMessages ?? 40;
  let processed = 0;
  let completed = 0;
  const nowIso = new Date().toISOString();

  while (processed < maxMessages) {
    const { data: jobs, error } = await admin
      .from('bot_broadcasts')
      .select(
        'id, status, scheduled_at, audience_title, title, recipients, delivered, failed, errors, payload, pending_chat_ids, admin_telegram_id, admin_notify_chat_id, text_preview',
      )
      .in('status', ['scheduled', 'sending'])
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .limit(1);
    if (error) throw error;
    const raw = (jobs ?? [])[0] as Record<string, unknown> | undefined;
    if (!raw) break;

    const row = normalizeJobRow(raw);
    if (row.status === 'scheduled' && row.scheduled_at && row.scheduled_at > nowIso) break;

    if (row.status === 'scheduled') {
      await admin.from('bot_broadcasts').update({ status: 'sending' }).eq('id', row.id);
      row.status = 'sending';
    }

    const payload = storedToPayload(row.payload ?? {});
    if (!payload.broadcastText) {
      await admin.from('bot_broadcasts').update({ status: 'cancelled', pending_chat_ids: [] }).eq('id', row.id);
      continue;
    }

    let pending = [...row.pending_chat_ids];
    let delivered = row.delivered;
    let failed = row.failed;
    const errors: BroadcastError[] = Array.isArray(row.errors)
      ? (row.errors as BroadcastError[]).slice(0, 500)
      : [];

    const chunk = pending.splice(0, Math.min(BROADCAST_CHUNK_SIZE, maxMessages - processed));
    for (const chatId of chunk) {
      const result = await sendOne(chatId, payload);
      if (result.ok) delivered += 1;
      else {
        failed += 1;
        if (errors.length < 500) errors.push({ name: `chat ${chatId}`, reason: result.reason ?? 'ошибка' });
      }
      processed += 1;
      await delay(BROADCAST_DELAY_MS);
      if (processed >= maxMessages) break;
    }

    const done = pending.length === 0;
    await admin
      .from('bot_broadcasts')
      .update({
        pending_chat_ids: pending,
        delivered,
        failed,
        errors,
        status: done ? 'completed' : 'sending',
      })
      .eq('id', row.id);

    if (done) {
      completed += 1;
      const finished = { ...row, delivered, failed, recipients: row.recipients };
    await notifyAdminJobDone(finished);
    try {
      const { logAdminAction } = await import('./action-log');
      await logAdminAction(admin, {
        actorTelegramId: row.admin_telegram_id,
        action: 'broadcast.complete',
        entityType: 'broadcast',
        entityId: row.id,
        detail: { delivered, failed, recipients: row.recipients },
      });
    } catch (logError) {
      console.error('[broadcast.complete]', logError);
    }
    }
    if (processed >= maxMessages) break;
  }

  return { processed, completed };
}
