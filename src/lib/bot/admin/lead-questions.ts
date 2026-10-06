import type { SupabaseClient } from '@supabase/supabase-js';
import { countOpenQuestionLeads } from '@/lib/bot/inquiry-leads';
import {
  type AdminMessage,
  type Deliver,
  type InlineButton,
  editAdminMessage,
  homeButton,
  shorten,
} from './core';
import { LEAD_SELECT_COLUMNS, type LeadRow } from './leads';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
import { staffStudentLabel } from '@/lib/bot/staff/messaging';
import { listLeadMessages } from './lead-messages';

const PER_PAGE = 6;

function questionPreview(lead: LeadRow): string {
  const text = lead.comment?.replace(/telegram_id:\d+\s*/g, '').trim();
  return text ? shorten(text, 60) : 'Сообщение';
}

async function listQuestionLeads(
  admin: SupabaseClient,
  page: number,
): Promise<{ rows: LeadRow[]; total: number }> {
  const from = page * PER_PAGE;
  const { data, error, count } = await admin
    .from('leads')
    .select(LEAD_SELECT_COLUMNS, { count: 'exact' })
    .in('inquiry_kind', ['student_question', 'guest_question'])
    .in('status', ['new', 'awaiting_reply', 'in_progress'])
    .order('created_at', { ascending: false })
    .range(from, from + PER_PAGE - 1);
  if (error) {
    if (String(error.message ?? '').includes('inquiry_kind')) return { rows: [], total: 0 };
    throw error;
  }
  return { rows: (data ?? []) as LeadRow[], total: count ?? 0 };
}

export async function renderLeadQuestionsList(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  const { rows, total } = await listQuestionLeads(admin, page);
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);

  const lines =
    rows.length === 0
      ? '💬 Вопросы студентов\n\nНет открытых обращений.'
      : [
          '💬 Вопросы студентов',
          '',
          ...(await Promise.all(
            rows.map(async (lead) => {
              const tg = lead.client_telegram_id ?? null;
              const who = tg ? await staffStudentLabel(admin, tg) : lead.name;
              return [`👨‍🎓 ${who}`, `💬 ${questionPreview(lead)}`, formatWhen(lead.created_at)].join('\n');
            }),
          )),
        ].join('\n\n');

  const keyboard: InlineButton[][] = rows.map((lead) => [
    { text: shorten(`${lead.name} · ${questionPreview(lead)}`, 48), callback_data: `al:q:v:${lead.id}:${safePage}` },
  ]);
  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data: safePage > 0 ? `al:q:p:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data: safePage < pageCount - 1 ? `al:q:p:${safePage + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push([{ text: '⬅️ Заявки', callback_data: 'al:menu' }], [homeButton()]);
  await editAdminMessage(message, lines, { inline_keyboard: keyboard });
}

export async function renderLeadQuestionDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  leadId: string,
  backPage: number,
  actorTelegramId: number,
): Promise<void> {
  const { data, error } = await admin.from('leads').select(LEAD_SELECT_COLUMNS).eq('id', leadId).maybeSingle();
  if (error) throw error;
  if (!data) {
    await editAdminMessage(message, 'Обращение не найдено.', {
      inline_keyboard: [[{ text: '⬅️ Назад', callback_data: `al:q:p:${backPage}` }]],
    });
    return;
  }
  const lead = data as LeadRow & { client_telegram_id?: number | null };
  const messages = await listLeadMessages(admin, leadId, { limit: 20 });
  const lines = [
    '💬 Обращение',
    '',
    `👤 ${lead.name}`,
    `📱 ${lead.contact}`,
    '',
    lead.comment ? `«${shorten(lead.comment.replace(/telegram_id:\d+\s*/g, '').trim(), 500)}»` : '',
  ].filter(Boolean);

  if (messages.length > 0) {
    lines.push('', 'Переписка:');
    for (const m of messages) {
      const who = m.direction === 'client_to_admin' ? 'Клиент' : 'Администрация';
      lines.push(`${who}: ${m.body ?? '(медиа)'}`);
    }
  }

  const keyboard: InlineButton[][] = [
    [{ text: '✉️ Ответить', callback_data: `al:rp:${leadId}:a:0:a` }],
    [{ text: '⬅️ Назад', callback_data: `al:q:p:${backPage}` }],
    [homeButton()],
  ];
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

export async function patchLeadsHubWithQuestions(
  lines: string[],
  keyboard: InlineButton[][],
  admin: SupabaseClient,
): Promise<void> {
  const q = await countOpenQuestionLeads(admin);
  lines.splice(3, 0, `💬 Вопросы студентов — ${q}`);
  keyboard.unshift([{ text: `💬 Вопросы студентов · ${q}`, callback_data: 'al:q:p:0' }]);
}

export function isLeadQuestionsAction(data: string): boolean {
  return data.startsWith('al:q:');
}

export async function handleLeadQuestionsAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  actorTelegramId: number,
): Promise<boolean> {
  const pageMatch = data.match(/^al:q:p:(\d+)$/);
  if (pageMatch) {
    await renderLeadQuestionsList(admin, message, Number(pageMatch[1]) || 0);
    return true;
  }
  const viewMatch = data.match(/^al:q:v:([^:]+):(\d+)$/);
  if (viewMatch) {
    await renderLeadQuestionDetail(admin, message, viewMatch[1], Number(viewMatch[2]) || 0, actorTelegramId);
    return true;
  }
  return false;
}
