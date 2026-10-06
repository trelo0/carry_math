import type { SupabaseClient } from '@supabase/supabase-js';
import { parseScheduleDateTime } from './education-ops';
import {
  type AdminMessage,
  type ConversationState,
  clearState,
  editAdminMessage,
  homeButton,
  saveState,
  sendAdminMessage,
} from './core';

export type LeadFollowupRow = {
  id: number;
  lead_id: string;
  kind: string;
  remind_at: string;
  done_at: string | null;
  note: string | null;
  created_by_telegram_id: number | null;
};

export function isLeadFollowupsTableError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  return message.includes('lead_followups');
}

export function remindAtFromDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

export async function createLeadFollowup(
  admin: SupabaseClient,
  input: {
    leadId: string;
    remindAt: string;
    createdByTelegramId: number;
    kind?: string;
    note?: string;
  },
): Promise<number | null> {
  const { data, error } = await admin
    .from('lead_followups')
    .insert({
      lead_id: input.leadId,
      kind: input.kind ?? 'thinking',
      remind_at: input.remindAt,
      note: input.note ?? null,
      created_by_telegram_id: input.createdByTelegramId,
    })
    .select('id')
    .single();
  if (error) {
    if (isLeadFollowupsTableError(error)) return null;
    throw error;
  }
  return data.id as number;
}

export async function listDueLeadFollowups(
  admin: SupabaseClient,
  limit = 10,
): Promise<Array<LeadFollowupRow & { lead_name: string | null }>> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('lead_followups')
    .select('id, lead_id, kind, remind_at, done_at, note, created_by_telegram_id, leads(name)')
    .is('done_at', null)
    .lte('remind_at', now)
    .order('remind_at', { ascending: true })
    .limit(limit);
  if (error) {
    if (isLeadFollowupsTableError(error)) return [];
    throw error;
  }
  return (data ?? []).map((row) => {
    const leads = row.leads as { name: string | null } | { name: string | null }[] | null;
    const lead = Array.isArray(leads) ? leads[0] : leads;
    return {
      ...(row as LeadFollowupRow),
      lead_name: lead?.name ?? null,
    };
  });
}

export async function completeLeadFollowup(admin: SupabaseClient, id: number): Promise<void> {
  const { error } = await admin
    .from('lead_followups')
    .update({ done_at: new Date().toISOString() })
    .eq('id', id);
  if (error && !isLeadFollowupsTableError(error)) throw error;
}

export async function renderThinkingReminderPicker(
  admin: SupabaseClient,
  message: AdminMessage,
  leadId: string,
  nav: string,
  clientName: string,
): Promise<void> {
  await editAdminMessage(
    message,
    `🔔 Напоминание\n\n${clientName}\nКлиент думает после пробного.\n\nКогда связаться снова?`,
    {
      inline_keyboard: [
        [{ text: '📅 Завтра', callback_data: `al:fu:1:${leadId}:${nav}` }],
        [{ text: '📅 Через 3 дня', callback_data: `al:fu:3:${leadId}:${nav}` }],
        [{ text: '📅 Через 7 дней', callback_data: `al:fu:7:${leadId}:${nav}` }],
        [{ text: '🕐 Другая дата', callback_data: `al:fu:custom:${leadId}:${nav}` }],
        [{ text: '◀️ К заявке', callback_data: `al:l:${leadId}:${nav}` }],
        [homeButton()],
      ],
    },
  );
}

export async function startCustomFollowupDate(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  leadId: string,
  nav: string,
): Promise<void> {
  await saveState(admin, telegramId, message, 'admin:lead:followup:date', {
    leadFollowupLeadId: leadId,
    leadFollowupNav: nav,
  });
  await editAdminMessage(message, '🕐 Дата напоминания (МСК):\nдд.мм.гггг чч:мм', {
    inline_keyboard: [[{ text: '◀️ Отмена', callback_data: `al:l:${leadId}:${nav}` }], [homeButton()]],
  });
}

export async function handleLeadFollowupTextStep(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  text: string,
): Promise<boolean> {
  if (state.step !== 'admin:lead:followup:date') return false;
  const leadId = state.payload.leadFollowupLeadId;
  const nav = state.payload.leadFollowupNav ?? 'a:0';
  if (!leadId) {
    await clearState(admin, telegramId);
    return true;
  }
  const remindAt = parseScheduleDateTime(text.trim());
  if (!remindAt) {
    await sendAdminMessage(state.chat_id, 'Пример: 10.10.2026 10:00');
    return true;
  }
  await createLeadFollowup(admin, {
    leadId,
    remindAt,
    createdByTelegramId: telegramId,
    note: 'Клиент думает после пробного',
  });
  await clearState(admin, telegramId);
  await sendAdminMessage(state.chat_id, `🔔 Напоминание поставлено на ${text.trim()}.`, {
    inline_keyboard: [[{ text: '◀️ К заявке', callback_data: `al:l:${leadId}:${nav}` }], [homeButton()]],
  });
  return true;
}

export async function handleLeadFollowupAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  actorTelegramId: number,
): Promise<boolean> {
  if (!data.startsWith('al:fu:')) return false;
  const parts = data.split(':');
  const kind = parts[2];

  if (kind === 'open') {
    const followupId = Number(parts[3]);
    const leadId = parts[4]!;
    const nav = `${parts[5] ?? 'w'}:${parts[6] ?? '0'}`;
    if (Number.isFinite(followupId)) await completeLeadFollowup(admin, followupId);
    await editAdminMessage(message, '🔔 Напоминание по заявке', {
      inline_keyboard: [[{ text: '📨 Открыть заявку', callback_data: `al:l:${leadId}:${nav}` }], [homeButton()]],
    });
    return true;
  }

  const leadId = parts[3]!;
  const nav = `${parts[4] ?? 'a'}:${parts[5] ?? '0'}`;

  if (kind === 'custom') {
    await startCustomFollowupDate(admin, actorTelegramId, message, leadId, nav);
    return true;
  }

  const days = Number(kind);
  if (!Number.isFinite(days) || days < 0) return true;
  await createLeadFollowup(admin, {
    leadId,
    remindAt: remindAtFromDays(days),
    createdByTelegramId: actorTelegramId,
    note: 'Клиент думает после пробного',
  });
  await editAdminMessage(message, `🔔 Напоминание через ${days} ${days === 1 ? 'день' : 'дн.'}.\n\nЗадача появится на главном экране в срок.`, {
    inline_keyboard: [[{ text: '◀️ К заявке', callback_data: `al:l:${leadId}:${nav}` }], [homeButton()]],
  });
  return true;
}
