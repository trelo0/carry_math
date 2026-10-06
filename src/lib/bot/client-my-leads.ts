import type { SupabaseClient } from '@supabase/supabase-js';
import { listLeadMessages } from './admin/lead-messages';
import type { LeadRow } from './admin/leads';
import { listClientInquiryLeads, type InquiryKind } from './inquiry-leads';
import {
  clientBackButton,
  loadClientHub,
  saveClientHub,
  sendHubMessage,
  editHubMessage,
} from './client-nav';
import { beginStudentSupportThreadFromLead } from './studentSupportFlow';
import { shorten } from './admin/core';

const STATUS_UI: Record<string, { emoji: string; label: string }> = {
  new: { emoji: '🔴', label: 'Новая' },
  awaiting_reply: { emoji: '🟡', label: 'Ожидает ответа' },
  in_progress: { emoji: '🟡', label: 'В работе' },
  completed: { emoji: '🟢', label: 'Завершена' },
  cancelled: { emoji: '⚫', label: 'Отменена' },
};

function statusEmoji(status: string | null): string {
  return STATUS_UI[status ?? 'new']?.emoji ?? '🟡';
}

function statusLabel(status: string | null): string {
  return STATUS_UI[status ?? 'new']?.label ?? 'В работе';
}

async function lastMessagePreview(admin: SupabaseClient, leadId: string): Promise<string> {
  const msgs = await listLeadMessages(admin, leadId, { limit: 1 });
  const body = msgs[0]?.body?.trim();
  if (!body) return '—';
  return shorten(body, 40);
}

export async function showClientApplicationsHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
): Promise<void> {
  const apps = await listClientInquiryLeads(admin, telegramId, ['application']);
  const questions = await listClientInquiryLeads(admin, telegramId, ['student_question', 'guest_question']);

  const lines = ['📨 Мои заявки', ''];
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  if (apps.length === 0 && questions.length === 0) {
    lines.push('Пока нет заявок и обращений.');
    keyboard.push([{ text: '🎓 Купить обучение', callback_data: 'cl:buy:hub' }]);
  } else {
    for (const lead of apps) {
      const preview = await lastMessagePreview(admin, lead.id);
      lines.push(
        `📚 ${lead.service ?? 'Заявка'}`,
        `${statusEmoji(lead.status)} ${statusLabel(lead.status)}`,
        `Последнее сообщение: ${preview}`,
        '',
      );
      keyboard.push([{ text: `${lead.service ?? 'Заявка'} · ${statusLabel(lead.status)}`, callback_data: `cl:my:app:${lead.id}` }]);
    }
    for (const lead of questions) {
      const preview = await lastMessagePreview(admin, lead.id);
      lines.push('💬 Обращение', `${statusEmoji(lead.status)} ${statusLabel(lead.status)}`, preview, '');
      keyboard.push([{ text: `💬 Обращение · ${preview}`, callback_data: `cl:my:q:${lead.id}` }]);
    }
  }

  keyboard.push([clientBackButton()]);

  const hub = await loadClientHub(admin, telegramId);
  const payload = { inline_keyboard: keyboard };
  if (hub) {
    const ok = await editHubMessage(hub, lines.join('\n').trim(), payload);
    if (ok) {
      await saveClientHub(admin, telegramId, hub, 'my-leads');
      return;
    }
  }
  const messageId = await sendHubMessage(chatId, lines.join('\n').trim(), payload);
  if (messageId) await saveClientHub(admin, telegramId, { chatId, messageId }, 'my-leads');
}

export async function showClientLeadThread(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  leadId: string,
  kind: InquiryKind | 'application',
): Promise<void> {
  const leads = await listClientInquiryLeads(
    admin,
    telegramId,
    kind === 'application' ? ['application'] : ['student_question', 'guest_question'],
  );
  const lead = leads.find((l) => l.id === leadId);
  if (!lead) {
    await sendHubMessage(chatId, 'Заявка не найдена.', { inline_keyboard: [[clientBackButton()]] });
    return;
  }

  const messages = await listLeadMessages(admin, leadId, { limit: 30 });
  const title = kind === 'application' ? '📨 Заявка' : '💬 Обращение';
  const lines = [
    title,
    '',
    lead.service ? `📚 ${lead.service}` : '',
    `${statusEmoji(lead.status)} ${statusLabel(lead.status)}`,
    '',
    '💬 Переписка',
    '',
  ].filter(Boolean);

  if (messages.length === 0) {
    lines.push('Сообщений пока нет.');
  } else {
    for (const m of messages) {
      const who = m.direction === 'client_to_admin' ? 'Вы' : 'Администрация';
      lines.push(`${who}: ${m.body ?? '(вложение)'}`);
    }
  }

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: '⬅️ К списку', callback_data: 'cl:my:menu' }],
  ];
  const openStatuses = new Set(['new', 'awaiting_reply', 'in_progress']);
  if (kind !== 'application' && openStatuses.has(lead.status ?? 'new')) {
    keyboard.unshift([{ text: '✍️ Написать ещё', callback_data: `cl:my:write:${leadId}` }]);
  }
  keyboard.push([clientBackButton()]);

  await sendHubMessage(chatId, lines.join('\n'), { inline_keyboard: keyboard });
}

export function isClientMyLeadsCallback(data: string): boolean {
  return data.startsWith('cl:my:');
}

export async function handleClientMyLeadsCallback(
  admin: SupabaseClient,
  data: string,
  chatId: number,
  telegramId: number,
): Promise<boolean> {
  if (data === 'cl:my:menu') {
    await showClientApplicationsHub(admin, telegramId, chatId);
    return true;
  }
  const app = data.match(/^cl:my:app:([^:]+)$/);
  if (app) {
    await showClientLeadThread(admin, telegramId, chatId, app[1], 'application');
    return true;
  }
  const q = data.match(/^cl:my:q:([^:]+)$/);
  if (q) {
    await showClientLeadThread(admin, telegramId, chatId, q[1], 'student_question');
    return true;
  }
  const write = data.match(/^cl:my:write:([^:]+)$/);
  if (write) {
    await beginStudentSupportThreadFromLead(admin, telegramId, chatId, write[1]);
    return true;
  }
  return false;
}
