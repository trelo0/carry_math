import type { SupabaseClient } from '@supabase/supabase-js';
import { formatShortDisplayId } from '@/lib/displayId';
import { telegramSend } from '@/lib/telegram';
import { resolveMemberChatId } from '../staff/messaging';
import {
  type AdminMessage,
  type ConversationState,
  type Deliver,
  type InlineButton,
  clearState,
  editAdminMessage,
  editDeliver,
  homeButton,
  migrationText,
  homeOnlyKeyboard,
  saveState,
  sendAdminMessage,
  shorten,
} from './core';
import { logAdminAction } from './action-log';
import { insertLeadMessage, listLeadMessages } from './lead-messages';
import { listLeadEvents, formatLeadEventLine } from './lead-events';
import { getActiveTrialForLead, syncTrialLessonConducted } from './lead-trial';
import { handleLeadTrialAction, isLeadTrialAction } from './lead-trial-flow';
import { handleLeadEnrollmentAction, isLeadEnrollmentAction } from './lead-enrollment-flow';
import { handleLeadFollowupAction } from './lead-followups';

// ---------------------------------------------------------------------------
// Раздел админ-панели: заявки (сайт + Telegram-бот, таблица leads)
// ---------------------------------------------------------------------------

// Статусы заявки. Храним текстом, как и роли бота, чтобы новые статусы
// добавлялись без миграций схемы.
export type LeadStatus =
  | 'new'
  | 'awaiting_reply'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type LeadSourceFilter = 'all' | 'telegram' | 'site';

export type LeadFilter = LeadStatus | 'all';

/** Категории списка в разделе «Заявки» (без ручного выбора статуса). */
export type LeadListCategory = 'new' | 'in_work' | 'completed' | 'all';

export type LeadRow = {
  id: string;
  created_at: string;
  name: string;
  contact: string;
  comment: string | null;
  teacher: string | null;
  service: string | null;
  grade: string | null;
  rating: string | null;
  rt_score: string | null;
  price: string | null;
  waitlist: boolean | null;
  spots_status: string | null;
  source: string | null;
  status: string | null;
  assigned_telegram_id?: number | null;
  inquiry_kind?: string | null;
  client_telegram_id?: number | null;
};

export type LeadStatusHistoryRow = {
  status: string;
  created_at: string;
  changed_by_telegram_id: number | null;
};

const TELEGRAM_BOT_SOURCE = 'telegram_bot';

const SOURCE_FILTER_CODE: Record<LeadSourceFilter, string> = {
  all: 'a',
  telegram: 't',
  site: 's',
};

export function parseLeadTelegramId(comment: string | null | undefined): number | null {
  if (!comment) return null;
  const match = comment.match(/telegram_id:(\d+)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

type LeadStatusMeta = { label: string; emoji: string; code: string };

const LEAD_STATUS_META: Record<LeadStatus, LeadStatusMeta> = {
  new: { label: 'Новая', emoji: '🔴', code: 'n' },
  awaiting_reply: { label: 'Ожидает ответа', emoji: '💬', code: 'w' },
  in_progress: { label: 'В работе', emoji: '🟡', code: 'i' },
  completed: { label: 'Выполнена', emoji: '🟢', code: 'd' },
  cancelled: { label: 'Отменена', emoji: '⚫', code: 'x' },
};

// Код фильтра 'a' — все заявки; коды статусов берутся из LEAD_STATUS_META.
const FILTER_ALL_CODE = 'a';

const LEADS_PER_PAGE = 10;
const CHAT_HISTORY_PAGE = 8;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusOf(lead: LeadRow): LeadStatus {
  const status = lead.status as LeadStatus | null;
  return status && status in LEAD_STATUS_META ? status : 'new';
}

function statusMeta(lead: LeadRow): LeadStatusMeta {
  return LEAD_STATUS_META[statusOf(lead)];
}

function filterFromCode(code: string | undefined): LeadFilter {
  if (!code || code === FILTER_ALL_CODE) return 'all';
  const found = (Object.keys(LEAD_STATUS_META) as LeadStatus[]).find(
    (status) => LEAD_STATUS_META[status].code === code,
  );
  return found ?? 'all';
}

function codeFromFilter(filter: LeadFilter): string {
  return filter === 'all' ? FILTER_ALL_CODE : LEAD_STATUS_META[filter].code;
}

const CATEGORY_CODES: Record<LeadListCategory, string> = {
  new: 'n',
  in_work: 'w',
  completed: 'g',
  all: 'a',
};

function categoryFromCode(code: string | undefined): LeadListCategory {
  if (!code || code === 'a') return 'all';
  if (code === 'n') return 'new';
  if (code === 'w' || code === 'i') return 'in_work';
  if (code === 'g' || code === 'd' || code === 'x') return 'completed';
  return 'all';
}

function codeFromCategory(category: LeadListCategory): string {
  return CATEGORY_CODES[category];
}

function categoryTitle(category: LeadListCategory): string {
  switch (category) {
    case 'new':
      return '📨 Новые заявки';
    case 'in_work':
      return '📨 Заявки в работе';
    case 'completed':
      return '📨 Завершённые заявки';
    default:
      return '📨 Все заявки';
  }
}

function applyCategoryFilter<T extends { eq: (c: string, v: string) => T; in: (c: string, v: string[]) => T }>(
  query: T,
  category: LeadListCategory,
): T {
  if (category === 'new') return query.eq('status', 'new');
  if (category === 'in_work') return query.in('status', ['awaiting_reply', 'in_progress']);
  if (category === 'completed') return query.in('status', ['completed', 'cancelled']);
  return query;
}

function hubCounts(counts: Record<LeadStatus, number> & { all: number }): {
  new: number;
  inWork: number;
  completed: number;
  all: number;
} {
  return {
    new: counts.new,
    inWork: counts.awaiting_reply + counts.in_progress,
    completed: counts.completed + counts.cancelled,
    all: counts.all,
  };
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatListWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const msk = (date: Date) =>
    date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long' });
  const today = msk(now);
  const day = msk(d);
  const time = formatTime(iso);
  if (day === today) return `Сегодня, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === msk(yesterday)) return `Вчера, ${time}`;
  return `${d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long' })}, ${time}`;
}

// Колонка status появляется только после миграции leads_status.sql.
export function isLeadPhase3ColumnError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  return (
    code === '42703' ||
    code === 'PGRST205' ||
    message.includes('assigned_telegram_id') ||
    message.includes('lead_status_history')
  );
}

export function isLeadStatusColumnError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  return (
    code === '42703' ||
    code === 'PGRST205' ||
    message.includes('leads.status') ||
    (message.includes('status') && message.includes('leads'))
  );
}

// ---------------------------------------------------------------------------
// Запросы к таблице leads
// ---------------------------------------------------------------------------

export const LEAD_SELECT_COLUMNS =
  'id, created_at, name, contact, comment, teacher, service, grade, rating, rt_score, price, waitlist, spots_status, source, status, assigned_telegram_id, inquiry_kind, client_telegram_id';

const LEAD_COLUMNS_LEGACY =
  'id, created_at, name, contact, comment, teacher, service, grade, rating, rt_score, price, waitlist, spots_status, source, status';

function leadSelectColumns(includePhase3: boolean): string {
  return includePhase3 ? LEAD_SELECT_COLUMNS : LEAD_COLUMNS_LEGACY;
}

function sourceFromCode(code: string | undefined): LeadSourceFilter {
  if (code === SOURCE_FILTER_CODE.telegram) return 'telegram';
  if (code === SOURCE_FILTER_CODE.site) return 'site';
  return 'all';
}

function codeFromSource(source: LeadSourceFilter): string {
  return SOURCE_FILTER_CODE[source];
}

function applySourceFilter<T extends { eq: (c: string, v: string) => T; or: (f: string) => T }>(
  query: T,
  source: LeadSourceFilter,
): T {
  if (source === 'telegram') return query.eq('source', TELEGRAM_BOT_SOURCE);
  if (source === 'site') return query.or(`source.is.null,source.neq.${TELEGRAM_BOT_SOURCE}`);
  return query;
}

function leadSourceLabel(lead: LeadRow): string {
  if (lead.source === TELEGRAM_BOT_SOURCE) return '✈️ Telegram';
  if (lead.source?.trim()) return `🌐 ${lead.source}`;
  return '🌐 Сайт';
}

// Счётчики по статусам одним запросом (status выбираем без остальных полей).
function isApplicationLead(row: { inquiry_kind?: string | null }): boolean {
  const kind = row.inquiry_kind;
  return !kind || kind === 'application';
}

async function countLeadsByStatus(
  admin: SupabaseClient,
): Promise<Record<LeadStatus, number> & { all: number }> {
  const counts: Record<LeadStatus, number> & { all: number } = {
    new: 0,
    awaiting_reply: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
    all: 0,
  };
  const { data, error } = await admin.from('leads').select('status, inquiry_kind').limit(1000);
  if (error) throw error;
  for (const row of data ?? []) {
    if (!isApplicationLead(row as { inquiry_kind?: string | null })) continue;
    const status = (row as { status: string | null }).status;
    const normalized: LeadStatus =
      status && status in LEAD_STATUS_META ? (status as LeadStatus) : 'new';
    counts[normalized] += 1;
    counts.all += 1;
  }
  return counts;
}

async function listLeads(
  admin: SupabaseClient,
  filter: LeadFilter,
  page: number,
  source: LeadSourceFilter,
  columns: string,
): Promise<{ leads: LeadRow[]; total: number }> {
  const from = page * LEADS_PER_PAGE;
  let query = admin.from('leads').select(columns, { count: 'exact' });
  if (filter !== 'all') query = query.eq('status', filter);
  query = applySourceFilter(query, source);
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + LEADS_PER_PAGE - 1);
  if (error) throw error;
  return { leads: (data ?? []) as unknown as LeadRow[], total: count ?? 0 };
}

async function listLeadsByCategory(
  admin: SupabaseClient,
  category: LeadListCategory,
  page: number,
  columns: string,
): Promise<{ leads: LeadRow[]; total: number }> {
  const from = page * LEADS_PER_PAGE;
  let query = admin.from('leads').select(columns, { count: 'exact' });
  query = applyCategoryFilter(query, category);
  query = query.or('inquiry_kind.eq.application,inquiry_kind.is.null');
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + LEADS_PER_PAGE - 1);
  if (error) {
    if (String(error.message ?? '').includes('inquiry_kind')) {
      let fallback = admin.from('leads').select(columns, { count: 'exact' });
      fallback = applyCategoryFilter(fallback, category);
      const res = await fallback
        .order('created_at', { ascending: false })
        .range(from, from + LEADS_PER_PAGE - 1);
      if (res.error) throw res.error;
      const filtered = ((res.data ?? []) as unknown as LeadRow[]).filter(isApplicationLead);
      return { leads: filtered, total: res.count ?? filtered.length };
    }
    throw error;
  }
  return { leads: (data ?? []) as unknown as LeadRow[], total: count ?? 0 };
}

async function searchLeads(admin: SupabaseClient, query: string, columns: string): Promise<LeadRow[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const shortId = trimmed.replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{2,8}$/i.test(shortId)) {
    const { data, error } = await admin
      .from('leads')
      .select(columns)
      .ilike('id', `${shortId}%`)
      .order('created_at', { ascending: false })
      .limit(15);
    if (error) throw error;
    return (data ?? []) as unknown as LeadRow[];
  }
  if (/^\d+$/.test(trimmed)) {
    const tgId = Number(trimmed);
    if (Number.isFinite(tgId)) {
      const { data, error } = await admin
        .from('leads')
        .select(columns)
        .or(`comment.ilike.%telegram_id:${tgId}%,contact.ilike.%${trimmed}%`)
        .order('created_at', { ascending: false })
        .limit(15);
      if (error) throw error;
      return (data ?? []) as unknown as LeadRow[];
    }
  }
  const escaped = trimmed.replace(/[%_]/g, '\\$&');
  const { data, error } = await admin
    .from('leads')
    .select(columns)
    .or(`name.ilike.%${escaped}%,contact.ilike.%${escaped}%`)
    .order('created_at', { ascending: false })
    .limit(15);
  if (error) throw error;
  return (data ?? []) as unknown as LeadRow[];
}

export async function getLead(admin: SupabaseClient, id: string, columns: string): Promise<LeadRow | null> {
  if (!UUID_RE.test(id)) return null;
  const { data, error } = await admin.from('leads').select(columns).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? (data as unknown as LeadRow) : null;
}

async function appendLeadStatusHistory(
  admin: SupabaseClient,
  leadId: string,
  status: LeadStatus,
  changedByTelegramId: number | null,
): Promise<void> {
  const { error } = await admin.from('lead_status_history').insert({
    lead_id: leadId,
    status,
    changed_by_telegram_id: changedByTelegramId,
  });
  if (error && !isLeadPhase3ColumnError(error)) throw error;
}

async function loadLeadStatusHistory(
  admin: SupabaseClient,
  leadId: string,
  limit = 5,
): Promise<LeadStatusHistoryRow[]> {
  const { data, error } = await admin
    .from('lead_status_history')
    .select('status, created_at, changed_by_telegram_id')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isLeadPhase3ColumnError(error)) return [];
    throw error;
  }
  return (data ?? []) as LeadStatusHistoryRow[];
}

export async function setLeadStatus(
  admin: SupabaseClient,
  id: string,
  status: LeadStatus,
  changedByTelegramId: number | null,
): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const { data, error } = await admin
    .from('leads')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  const ok = (data ?? []).length > 0;
  if (ok) {
    await appendLeadStatusHistory(admin, id, status, changedByTelegramId);
    if (changedByTelegramId) {
      await logAdminAction(admin, {
        actorTelegramId: changedByTelegramId,
        action: 'lead.status',
        entityType: 'lead',
        entityId: id,
        detail: { status },
      });
    }
  }
  return ok;
}

async function setLeadAssignee(
  admin: SupabaseClient,
  id: string,
  assigneeTelegramId: number | null,
  actorTelegramId?: number,
): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const { data, error } = await admin
    .from('leads')
    .update({ assigned_telegram_id: assigneeTelegramId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) {
    if (isLeadPhase3ColumnError(error)) return false;
    throw error;
  }
  const ok = (data ?? []).length > 0;
  if (ok && actorTelegramId) {
    await logAdminAction(admin, {
      actorTelegramId,
      action: 'lead.assignee',
      entityType: 'lead',
      entityId: id,
      detail: { assigned_telegram_id: assigneeTelegramId },
    });
  }
  return ok;
}

export async function resolveLinkedTelegramId(admin: SupabaseClient, lead: LeadRow): Promise<number | null> {
  if (lead.client_telegram_id && lead.client_telegram_id > 0) return lead.client_telegram_id;
  const fromComment = parseLeadTelegramId(lead.comment);
  if (fromComment) return fromComment;
  const digits = lead.contact.replace(/\D/g, '');
  if (digits.length < 5) return null;
  const { data: link } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .ilike('phone', `%${digits.slice(-10)}%`)
    .limit(1)
    .maybeSingle();
  if (link?.telegram_id) return link.telegram_id as number;
  const { data: member } = await admin
    .from('bot_members')
    .select('telegram_id')
    .ilike('phone', `%${digits.slice(-10)}%`)
    .limit(1)
    .maybeSingle();
  return member?.telegram_id ?? null;
}

async function listAdminAssigneeCandidates(
  admin: SupabaseClient,
): Promise<Array<{ telegram_id: number; full_name: string | null }>> {
  const envIds = (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const roleFilter = envIds.length
    ? `role.eq.admin,telegram_id.in.(${envIds.join(',')})`
    : 'role.eq.admin';
  const { data, error } = await admin
    .from('bot_members')
    .select('telegram_id, full_name')
    .or(roleFilter)
    .order('full_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Array<{ telegram_id: number; full_name: string | null }>;
}

async function memberDisplayName(admin: SupabaseClient, telegramId: number): Promise<string> {
  const { data } = await admin
    .from('bot_members')
    .select('full_name')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  const name = (data as { full_name: string | null } | null)?.full_name?.trim();
  return name || `ID ${telegramId}`;
}

// ---------------------------------------------------------------------------
// Отрисовка раздела
// ---------------------------------------------------------------------------

function leadServiceLine(lead: LeadRow): string | null {
  if (lead.service) return `📚 ${lead.service}`;
  if (lead.teacher) return `👨‍🏫 ${lead.teacher}`;
  return null;
}

function leadListSubtitle(lead: LeadRow): string {
  const format = lead.grade?.trim() ? lead.grade : lead.service?.includes('групп') ? 'Группа' : 'Индивидуальное';
  const subject = lead.service?.trim() || lead.teacher?.trim() || '—';
  return `${format} · ${subject}`;
}

function leadCard(lead: LeadRow, index: number): string {
  return [
    `${index}. ${lead.name}`,
    `   ${leadListSubtitle(lead)}`,
    `   ${formatListWhen(lead.created_at)}`,
  ].join('\n');
}

function listNavSuffix(category: LeadListCategory, page: number): string {
  return `${codeFromCategory(category)}:${page}`;
}

function parseListContext(parts: string[]): { category: LeadListCategory; page: number; source: LeadSourceFilter } {
  const category = categoryFromCode(parts[0]);
  const page = Math.max(0, Number(parts[1]) || 0);
  const source = sourceFromCode(parts[2]);
  return { category, page, source };
}

function paginationRow(category: LeadListCategory, safePage: number, pageCount: number): InlineButton[] {
  const nav = (p: number) => `al:f:${listNavSuffix(category, p)}`;
  const row: InlineButton[] = [];
  const windowSize = 4;
  let start = Math.max(0, safePage - Math.floor(windowSize / 2));
  if (start + windowSize > pageCount) start = Math.max(0, pageCount - windowSize);
  for (let p = start; p < Math.min(pageCount, start + windowSize); p += 1) {
    row.push({
      text: p === safePage ? `[${p + 1}]` : `${p + 1}`,
      callback_data: p === safePage ? 'noop' : nav(p),
    });
  }
  if (pageCount > start + windowSize) {
    row.push({ text: '▶️', callback_data: nav(Math.min(pageCount - 1, safePage + 1)) });
  }
  return row;
}

let leadColumnsCache: string | null = null;

async function resolveLeadColumns(admin: SupabaseClient): Promise<string> {
  if (leadColumnsCache) return leadColumnsCache;
  const { error } = await admin.from('leads').select('assigned_telegram_id').limit(1);
  leadColumnsCache =
    error && isLeadPhase3ColumnError(error) ? LEAD_COLUMNS_LEGACY : LEAD_SELECT_COLUMNS;
  return leadColumnsCache;
}

async function renderLeadsHub(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const counts = await countLeadsByStatus(admin);
  const hub = hubCounts(counts);
  const text = [
    '📨 Заявки',
    '',
    `🔴 Новые — ${hub.new}`,
    `🟡 В работе — ${hub.inWork}`,
    `🟢 Завершённые — ${hub.completed}`,
    '',
    `Всего заявок: ${hub.all}`,
  ];
  const keyboard: InlineButton[][] = [
    [{ text: `🔴 Новые · ${hub.new}`, callback_data: `al:f:${listNavSuffix('new', 0)}` }],
    [{ text: `🟡 В работе · ${hub.inWork}`, callback_data: `al:f:${listNavSuffix('in_work', 0)}` }],
    [{ text: '📋 Все заявки', callback_data: `al:f:${listNavSuffix('all', 0)}` }],
    [{ text: '🔎 Найти заявку', callback_data: 'al:search' }],
    [homeButton()],
  ];
  const { patchLeadsHubWithQuestions } = await import('./lead-questions');
  await patchLeadsHubWithQuestions(text, keyboard, admin);
  await deliver(text.join('\n'), { inline_keyboard: keyboard });
}

async function renderLeadsList(
  admin: SupabaseClient,
  deliver: Deliver,
  category: LeadListCategory,
  page: number,
): Promise<void> {
  const columns = await resolveLeadColumns(admin);
  const { leads, total } = await listLeadsByCategory(admin, category, page, columns);
  const pageCount = Math.max(1, Math.ceil(total / LEADS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const nav = listNavSuffix(category, safePage);

  const keyboard: InlineButton[][] = leads.map((lead) => [
    {
      text: `👤 ${shorten(lead.name, 22)} · ${shorten(lead.service || lead.teacher || '—', 14)}`,
      callback_data: `al:l:${lead.id}:${nav}`,
    },
  ]);

  if (pageCount > 1) keyboard.push(paginationRow(category, safePage, pageCount));
  keyboard.push(
    [{ text: '⬅️ К обзору', callback_data: 'al:menu' }],
    [homeButton()],
  );

  const from = total === 0 ? 0 : safePage * LEADS_PER_PAGE + 1;
  const to = Math.min(total, (safePage + 1) * LEADS_PER_PAGE);
  const text =
    total === 0
      ? `${categoryTitle(category)}\n\nПока пусто.`
      : [
          categoryTitle(category),
          '',
          `Показано ${from}–${to} из ${total}`,
          '',
          ...leads.map((lead, index) => leadCard(lead, from + index)),
        ].join('\n');

  await deliver(text, { inline_keyboard: keyboard });
}

export async function renderLeadsMenu(
  admin: SupabaseClient,
  deliver: Deliver,
  openCategory?: LeadListCategory,
): Promise<void> {
  if (openCategory) await renderLeadsList(admin, deliver, openCategory, 0);
  else await renderLeadsHub(admin, deliver);
}

function leadStatusLine(lead: LeadRow): string {
  const meta = statusMeta(lead);
  return `${meta.emoji} ${meta.label}`;
}

function leadInitialMessage(lead: LeadRow): string | null {
  const commentForDisplay = lead.comment?.replace(/telegram_id:\d+\s*/g, '').trim();
  return commentForDisplay || null;
}

async function renderLeadDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  lead: LeadRow,
  category: LeadListCategory,
  page: number,
  _actorTelegramId: number,
): Promise<void> {
  const nav = listNavSuffix(category, page);
  const shortId = formatShortDisplayId(lead.id);
  const lines = [`📨 Заявка ${shortId ?? ''}`.trim(), '', `👤 ${lead.name}`, `📱 ${lead.contact}`];
  if (lead.source === TELEGRAM_BOT_SOURCE) lines.push('💬 Telegram');
  else lines.push(leadSourceLabel(lead));

  if (lead.service) lines.push(`📚 ${lead.service}`);
  if (lead.grade) lines.push(`🎓 ${lead.grade}`);
  if (lead.teacher) lines.push(`👨‍🏫 ${lead.teacher}`);

  const initial = leadInitialMessage(lead);
  if (initial) {
    lines.push('', '💬 Сообщение', '', initial);
  }

  lines.push('', '📍 Источник', lead.source === TELEGRAM_BOT_SOURCE ? 'Telegram' : leadSourceLabel(lead));
  lines.push('', `🕐 Создана: ${formatDateTime(lead.created_at)}`, '', leadStatusLine(lead));

  const trial = await getActiveTrialForLead(admin, lead.id);
  if (trial) {
    await syncTrialLessonConducted(admin, trial);
    const tName = trial.teacher_telegram_id
      ? await memberDisplayName(admin, trial.teacher_telegram_id)
      : '—';
    lines.push('', '📅 Пробное', `${formatListWhen(trial.starts_at).replace(/^Сегодня, /, '')}`, `👨‍🏫 ${tName}`);
    const price = Number(trial.trial_price_byn ?? 0);
    if (price > 0) {
      const payLabel =
        trial.trial_payment_status === 'paid'
          ? 'оплачено'
          : trial.trial_payment_status === 'pending'
            ? 'ожидает оплаты'
            : trial.trial_payment_status === 'skipped'
              ? 'не запрашивалась'
              : '—';
      lines.push('', '💳 Оплата', `${price} BYN · ${payLabel}`);
    }
    if (trial.trial_payment_status === 'paid' || trial.trial_payment_status === 'skipped') {
      lines.push('', '🟢 Пробное подтверждено');
    } else if (trial.trial_payment_status === 'pending') {
      lines.push('', '💳 Ожидает оплаты');
    }
    if (trial.status === 'completed') lines.push('', '🟡 Пробное проведено');
  }

  const events = await listLeadEvents(admin, lead.id, 4);
  if (events.length > 0) {
    lines.push('', '📋 События');
    for (const ev of events.reverse()) {
      lines.push(formatLeadEventLine(ev, formatDateTime));
    }
  }

  const linkedId = await resolveLinkedTelegramId(admin, lead);
  const keyboard: InlineButton[][] = [
    [
      { text: '💬 Ответить', callback_data: `al:rp:${lead.id}:${nav}` },
      { text: '📜 История чата', callback_data: `al:hist:${lead.id}:${nav}:0` },
    ],
    [
      {
        text: '👤 Открыть человека',
        callback_data: linkedId != null ? `admin:user:${linkedId}::` : `al:l:${lead.id}:${nav}`,
      },
      { text: '⋯ Другие действия', callback_data: `al:mo:${lead.id}:${nav}` },
    ],
    [{ text: '📅 Оформить пробное', callback_data: `al:tr:${lead.id}:${nav}` }],
    [{ text: '◀️ К списку', callback_data: `al:f:${nav}` }, { text: '⬅️ Обзор', callback_data: 'al:menu' }],
    [homeButton()],
  ];

  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

async function renderLeadMoreMenu(
  admin: SupabaseClient,
  message: AdminMessage,
  lead: LeadRow,
  category: LeadListCategory,
  page: number,
): Promise<void> {
  const nav = listNavSuffix(category, page);
  const st = statusOf(lead);
  const keyboard: InlineButton[][] = [];
  if (st === 'completed' || st === 'cancelled') {
    keyboard.push([{ text: '🔄 Вернуть в работу', callback_data: `al:rw:${lead.id}:${nav}` }]);
  } else {
    keyboard.push([{ text: '❌ Закрыть заявку', callback_data: `al:cl:${lead.id}:${nav}` }]);
  }
  keyboard.push(
    [{ text: '📜 История чата', callback_data: `al:hist:${lead.id}:${nav}:0` }],
    [{ text: '👔 Назначить ответственного', callback_data: `al:as:${lead.id}:${nav}` }],
    [{ text: '◀️ К заявке', callback_data: `al:l:${lead.id}:${nav}` }],
    [homeButton()],
  );
  await editAdminMessage(message, `⋯ Другие действия\n\n${lead.name}`, { inline_keyboard: keyboard });
}

async function renderLeadChatHistory(
  admin: SupabaseClient,
  message: AdminMessage,
  lead: LeadRow,
  category: LeadListCategory,
  page: number,
  beforeId: number,
): Promise<void> {
  const nav = listNavSuffix(category, page);
  const rows = await listLeadMessages(admin, lead.id, {
    limit: CHAT_HISTORY_PAGE + 1,
    beforeId: beforeId > 0 ? beforeId : undefined,
  });
  const hasMore = rows.length > CHAT_HISTORY_PAGE;
  const slice = hasMore ? rows.slice(0, CHAT_HISTORY_PAGE) : rows;
  const chronological = [...slice].reverse();
  const lines = ['📜 История чата', lead.name, ''];
  if (chronological.length === 0) {
    const fallback = leadInitialMessage(lead);
    if (fallback) {
      lines.push(`${lead.name.split(' ')[0] ?? 'Клиент'}:`, fallback);
    } else lines.push('Пока нет сохранённых сообщений.');
  } else {
    for (const msg of chronological) {
      const who = msg.direction === 'admin_to_client' ? 'Админ' : lead.name.split(' ')[0] ?? 'Клиент';
      const body =
        msg.body?.trim() ||
        (msg.message_type === 'photo'
          ? '📷 Фото'
          : msg.message_type === 'voice'
            ? '🎤 Голосовое'
            : msg.message_type === 'document'
              ? '📎 Документ'
              : `[${msg.message_type}]`);
      lines.push(`${who}:`, body, '');
    }
  }
  const oldestId = slice.length > 0 ? slice[slice.length - 1]!.id : 0;
  const keyboard: InlineButton[][] = [];
  if (hasMore && oldestId > 0) {
    keyboard.push([
      { text: '⬆️ Более ранние сообщения', callback_data: `al:hist:${lead.id}:${nav}:${oldestId}` },
    ]);
  }
  keyboard.push([{ text: '⬅️ Назад', callback_data: `al:l:${lead.id}:${nav}` }], [homeButton()]);
  await editAdminMessage(message, lines.join('\n').trim(), { inline_keyboard: keyboard });
}

async function startLeadReply(
  admin: SupabaseClient,
  adminTelegramId: number,
  message: AdminMessage,
  lead: LeadRow,
  category: LeadListCategory,
  page: number,
): Promise<void> {
  const nav = listNavSuffix(category, page);
  const linkedId = await resolveLinkedTelegramId(admin, lead);
  if (!linkedId) {
    await editAdminMessage(message, 'Не удалось найти Telegram клиента для этой заявки.', {
      inline_keyboard: [[{ text: '◀️ Назад', callback_data: `al:l:${lead.id}:${nav}` }], [homeButton()]],
    });
    return;
  }
  if (statusOf(lead) === 'new') {
    await setLeadStatus(admin, lead.id, 'in_progress', adminTelegramId);
  }
  await saveState(admin, adminTelegramId, message, 'admin:lead:reply', {
    leadReplyLeadId: lead.id,
    leadReplyNav: nav,
    leadReplyClientTelegramId: linkedId,
  });
  await sendAdminMessage(
    message.chatId,
    `💬 Переписка с ${lead.name}\n\nНапишите сообщение — оно уйдёт клиенту от имени District.\nКаждое сообщение отправляется отдельно.\n\nЗавершить: кнопка ниже или «⬅️ Обзор».`,
    {
      inline_keyboard: [
        [{ text: '⏹ Завершить переписку', callback_data: `al:rp:stop:${lead.id}:${nav}` }],
        [{ text: '◀️ К заявке', callback_data: `al:l:${lead.id}:${nav}` }],
        [homeButton()],
      ],
    },
  );
}

export async function handleAdminLeadReplyStep(
  admin: SupabaseClient,
  adminTelegramId: number,
  state: ConversationState,
  text: string,
): Promise<boolean> {
  if (state.step !== 'admin:lead:reply') return false;
  const leadId = state.payload.leadReplyLeadId;
  const clientTgId = state.payload.leadReplyClientTelegramId;
  const nav = state.payload.leadReplyNav ?? 'a:0';
  if (!leadId || !clientTgId) {
    await clearState(admin, adminTelegramId);
    return true;
  }
  const body = text.trim();
  if (!body) {
    await sendAdminMessage(state.chat_id, 'Введите непустой текст.');
    return true;
  }
  const chatId = await resolveMemberChatId(admin, clientTgId);
  if (!chatId) {
    await sendAdminMessage(state.chat_id, 'У клиента нет chat_id — бот не может написать.');
    return true;
  }
  const result = await telegramSend('sendMessage', { chat_id: chatId, text: body });
  if (result.ok && result.result && typeof result.result === 'object') {
    const tgMsgId = (result.result as { message_id?: number }).message_id;
    await insertLeadMessage(admin, {
      leadId,
      direction: 'admin_to_client',
      senderTelegramId: adminTelegramId,
      telegramMessageId: tgMsgId ?? null,
      body,
    });
    const { logLeadEvent } = await import('./lead-events');
    await logLeadEvent(admin, {
      leadId,
      eventType: 'admin_reply',
      actorTelegramId: adminTelegramId,
      detail: { length: body.length },
    });
    await setLeadStatus(admin, leadId, 'in_progress', adminTelegramId);
    await logAdminAction(admin, {
      actorTelegramId: adminTelegramId,
      action: 'lead.reply',
      entityType: 'lead',
      entityId: leadId,
      detail: { length: body.length },
    });
  }
  await sendAdminMessage(
    state.chat_id,
    result.ok ? '✅ Отправлено клиенту.' : `❌ Не удалось: ${result.description ?? 'ошибка'}`,
    {
      inline_keyboard: [
        [{ text: '⏹ Завершить переписку', callback_data: `al:rp:stop:${leadId}:${nav}` }],
        [{ text: '◀️ К заявке', callback_data: `al:l:${leadId}:${nav}` }],
        [homeButton()],
      ],
    },
  );
  return true;
}

async function promptLeadSearch(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
): Promise<void> {
  await saveState(admin, telegramId, message, 'admin:leads:search', { searchBack: 'al:menu' });
  await editAdminMessage(
    message,
    '🔎 Поиск заявки\n\nИмя, телефон, Telegram ID, username или короткий ID (#2dc03f).\nМинимум 2 символа.',
    {
      inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'al:menu' }], [homeButton()]],
    },
  );
}

export async function renderLeadsSearchResults(
  admin: SupabaseClient,
  state: ConversationState,
  query: string,
): Promise<void> {
  const chatId = state.chat_id;
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    await sendAdminMessage(chatId, 'Запрос слишком короткий — минимум 2 символа.', {
      inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'al:menu' }], [homeButton()]],
    });
    return;
  }
  const columns = await resolveLeadColumns(admin);
  const leads = await searchLeads(admin, trimmed, columns);
  if (leads.length === 0) {
    await sendAdminMessage(chatId, `По «${trimmed}» заявок не найдено.`, {
      inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'al:menu' }], [homeButton()]],
    });
    return;
  }
  const lines = ['🔎 Результаты', ''];
  for (const lead of leads) {
    lines.push(`${formatShortDisplayId(lead.id) ?? '—'} · ${lead.name}`, `📱 ${lead.contact}`, '');
  }
  const keyboard: InlineButton[][] = leads.map((lead) => [
    {
      text: `👤 ${shorten(lead.name, 36)} ${formatShortDisplayId(lead.id) ?? ''}`.trim(),
      callback_data: `al:l:${lead.id}:a:0`,
    },
  ]);
  keyboard.push([{ text: '⬅️ Назад', callback_data: 'al:menu' }], [homeButton()]);
  await sendAdminMessage(chatId, lines.join('\n').trim(), { inline_keyboard: keyboard });
}

async function renderLeadAssignPicker(
  admin: SupabaseClient,
  message: AdminMessage,
  lead: LeadRow,
  category: LeadListCategory,
  page: number,
): Promise<void> {
  const nav = listNavSuffix(category, page);
  const candidates = await listAdminAssigneeCandidates(admin);
  const keyboard: InlineButton[][] = candidates.map((row) => [
    {
      text: shorten(row.full_name?.trim() || `ID ${row.telegram_id}`, 36),
      callback_data: `al:aa:${lead.id}:${row.telegram_id}:${nav}`,
    },
  ]);
  keyboard.push([{ text: '◀️ К заявке', callback_data: `al:l:${lead.id}:${nav}` }], [homeButton()]);
  const text = [`📝 Заявка · ${lead.name}`, '', 'Выберите ответственного:'].join('\n');
  await editAdminMessage(message, text, { inline_keyboard: keyboard });
}

// ---------------------------------------------------------------------------
// Обработка inline-кнопок раздела (префикс al:)
// ---------------------------------------------------------------------------

export function isLeadsAction(data: string): boolean {
  return data.startsWith('al:');
}

// Роль повторно проверяется в handleAdminCallback до вызова этого обработчика.
export async function handleLeadsAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  actorTelegramId: number,
): Promise<boolean> {
  const deliver = editDeliver(message);
  const columns = await resolveLeadColumns(admin);

  try {
    if (isLeadTrialAction(data)) {
      return await handleLeadTrialAction(admin, data, message, actorTelegramId, deliver);
    }
    if (isLeadEnrollmentAction(data)) {
      return await handleLeadEnrollmentAction(admin, data, message, actorTelegramId, deliver);
    }
    if (data.startsWith('al:fu:')) {
      return await handleLeadFollowupAction(admin, data, message, actorTelegramId);
    }

    if (data === 'al:menu') {
      await renderLeadsHub(admin, deliver);
      return true;
    }

    const { isLeadQuestionsAction, handleLeadQuestionsAction } = await import('./lead-questions');
    if (isLeadQuestionsAction(data)) {
      return handleLeadQuestionsAction(admin, data, message, actorTelegramId);
    }

    if (data === 'al:search') {
      await promptLeadSearch(admin, actorTelegramId, message);
      return true;
    }

    if (data.startsWith('al:so:')) {
      const [, , , filterCode, pageRaw] = data.split(':');
      const category = categoryFromCode(filterCode);
      await renderLeadsList(admin, deliver, category, Math.max(0, Number(pageRaw) || 0));
      return true;
    }

    if (data.startsWith('al:f:')) {
      const parts = data.slice('al:f:'.length).split(':');
      const ctx = parseListContext(parts);
      await renderLeadsList(admin, deliver, ctx.category, ctx.page);
      return true;
    }

    // al:l:<id>:<фильтр>:<страница>[:источник]
    if (data.startsWith('al:l:')) {
      const rest = data.slice('al:l:'.length);
      const colon = rest.indexOf(':');
      const id = colon >= 0 ? rest.slice(0, colon) : rest;
      const navParts = (colon >= 0 ? rest.slice(colon + 1) : 'n:0:a').split(':');
      const ctx = parseListContext(navParts);
      const lead = await getLead(admin, id, columns);
      if (!lead) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await renderLeadDetail(admin, message, lead, ctx.category, ctx.page, actorTelegramId);
      return true;
    }

    if (data.startsWith('al:mo:')) {
      const rest = data.slice('al:mo:'.length);
      const colon = rest.indexOf(':');
      const id = colon >= 0 ? rest.slice(0, colon) : rest;
      const ctx = parseListContext((colon >= 0 ? rest.slice(colon + 1) : 'a:0').split(':'));
      const lead = await getLead(admin, id, columns);
      if (!lead) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await renderLeadMoreMenu(admin, message, lead, ctx.category, ctx.page);
      return true;
    }

    if (data.startsWith('al:hist:')) {
      const parts = data.slice('al:hist:'.length).split(':');
      const id = parts[0] ?? '';
      const ctx = parseListContext(parts.slice(1, 3));
      const beforeId = Number(parts[3]) || 0;
      const lead = await getLead(admin, id, columns);
      if (!lead) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await renderLeadChatHistory(admin, message, lead, ctx.category, ctx.page, beforeId);
      return true;
    }

    if (data.startsWith('al:rp:stop:')) {
      const rest = data.slice('al:rp:stop:'.length);
      const colon = rest.indexOf(':');
      const id = colon >= 0 ? rest.slice(0, colon) : rest;
      const ctx = parseListContext((colon >= 0 ? rest.slice(colon + 1) : 'a:0').split(':'));
      await clearState(admin, actorTelegramId);
      const lead = await getLead(admin, id, columns);
      if (lead) await renderLeadDetail(admin, message, lead, ctx.category, ctx.page, actorTelegramId);
      else await deliver('Переписка завершена.', { inline_keyboard: [[homeButton()]] });
      return true;
    }

    if (data.startsWith('al:rp:')) {
      const rest = data.slice('al:rp:'.length);
      const colon = rest.indexOf(':');
      const id = colon >= 0 ? rest.slice(0, colon) : rest;
      const ctx = parseListContext((colon >= 0 ? rest.slice(colon + 1) : 'a:0').split(':'));
      const lead = await getLead(admin, id, columns);
      if (!lead) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await startLeadReply(admin, actorTelegramId, message, lead, ctx.category, ctx.page);
      return true;
    }

    if (data.startsWith('al:cl:')) {
      const rest = data.slice('al:cl:'.length);
      const colon = rest.indexOf(':');
      const id = colon >= 0 ? rest.slice(0, colon) : rest;
      const ctx = parseListContext((colon >= 0 ? rest.slice(colon + 1) : 'a:0').split(':'));
      await setLeadStatus(admin, id, 'cancelled', actorTelegramId);
      const { logLeadEvent } = await import('./lead-events');
      await logLeadEvent(admin, {
        leadId: id,
        eventType: 'lead_closed',
        actorTelegramId,
        detail: { reason: 'manual' },
      });
      const lead = await getLead(admin, id, columns);
      if (!lead) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await renderLeadDetail(admin, message, lead, ctx.category, ctx.page, actorTelegramId);
      return true;
    }

    if (data.startsWith('al:rw:')) {
      const rest = data.slice('al:rw:'.length);
      const colon = rest.indexOf(':');
      const id = colon >= 0 ? rest.slice(0, colon) : rest;
      const ctx = parseListContext((colon >= 0 ? rest.slice(colon + 1) : 'a:0').split(':'));
      await setLeadStatus(admin, id, 'in_progress', actorTelegramId);
      const { logLeadEvent: logReopen } = await import('./lead-events');
      await logReopen(admin, { leadId: id, eventType: 'lead_reopened', actorTelegramId });
      const lead = await getLead(admin, id, columns);
      if (!lead) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await renderLeadDetail(admin, message, lead, ctx.category, ctx.page, actorTelegramId);
      return true;
    }

    // al:as:<id>:<nav...>
    if (data.startsWith('al:as:')) {
      const rest = data.slice('al:as:'.length);
      const colon = rest.indexOf(':');
      const id = colon >= 0 ? rest.slice(0, colon) : rest;
      const ctx = parseListContext((colon >= 0 ? rest.slice(colon + 1) : 'n:0:a').split(':'));
      const lead = await getLead(admin, id, columns);
      if (!lead) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await renderLeadAssignPicker(admin, message, lead, ctx.category, ctx.page);
      return true;
    }

    // al:me:<id>:<nav...>
    if (data.startsWith('al:me:')) {
      const rest = data.slice('al:me:'.length);
      const colon = rest.indexOf(':');
      const id = colon >= 0 ? rest.slice(0, colon) : rest;
      const ctx = parseListContext((colon >= 0 ? rest.slice(colon + 1) : 'n:0:a').split(':'));
      await setLeadAssignee(admin, id, actorTelegramId, actorTelegramId);
      const lead = await getLead(admin, id, columns);
      if (!lead) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await renderLeadDetail(admin, message, lead, ctx.category, ctx.page, actorTelegramId);
      return true;
    }

    // al:ac:<id>:<nav...>
    if (data.startsWith('al:ac:')) {
      const rest = data.slice('al:ac:'.length);
      const colon = rest.indexOf(':');
      const id = colon >= 0 ? rest.slice(0, colon) : rest;
      const ctx = parseListContext((colon >= 0 ? rest.slice(colon + 1) : 'n:0:a').split(':'));
      await setLeadAssignee(admin, id, null, actorTelegramId);
      const lead = await getLead(admin, id, columns);
      if (!lead) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await renderLeadDetail(admin, message, lead, ctx.category, ctx.page, actorTelegramId);
      return true;
    }

    // al:aa:<id>:<assigneeId>:<nav...>
    if (data.startsWith('al:aa:')) {
      const parts = data.slice('al:aa:'.length).split(':');
      const id = parts[0] ?? '';
      const assigneeRaw = parts[1];
      const assigneeId = assigneeRaw ? Number(assigneeRaw) : NaN;
      const ctx = parseListContext(parts.slice(2));
      if (Number.isFinite(assigneeId)) await setLeadAssignee(admin, id, assigneeId, actorTelegramId);
      const lead = await getLead(admin, id, columns);
      if (!lead) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await renderLeadDetail(admin, message, lead, ctx.category, ctx.page, actorTelegramId);
      return true;
    }

    // al:s:<id>:<статус>:<nav...>  (legacy: al:s:id:status:filter:page)
    if (data.startsWith('al:s:')) {
      const parts = data.slice('al:s:'.length).split(':');
      const id = parts[0] ?? '';
      const statusCode = parts[1];
      const status = (Object.keys(LEAD_STATUS_META) as LeadStatus[]).find(
        (key) => LEAD_STATUS_META[key].code === statusCode,
      );
      const ctx = parseListContext(parts.slice(2));
      if (status) await setLeadStatus(admin, id, status, actorTelegramId);
      const lead = await getLead(admin, id, columns);
      if (!lead) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await renderLeadDetail(admin, message, lead, ctx.category, ctx.page, actorTelegramId);
      return true;
    }
  } catch (error) {
    if (isLeadStatusColumnError(error)) {
      await deliver(migrationText('leads_status.sql'), homeOnlyKeyboard());
      return true;
    }
    if (isLeadPhase3ColumnError(error)) {
      await deliver(migrationText('leads_phase3.sql'), homeOnlyKeyboard());
      return true;
    }
    await deliver('❌ Не удалось загрузить заявки.\nПопробуйте ещё раз позже.', homeOnlyKeyboard());
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Уведомление администраторов о новой заявке
// ---------------------------------------------------------------------------

// Собирает chat_id администраторов: роль admin в bot_members плюс владельцы
// из ADMIN_TELEGRAM_IDS. Только те, у кого сохранён chat_id (бот может писать).
async function getAdminChatIds(admin: SupabaseClient): Promise<number[]> {
  const envIds = (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const roleFilter = envIds.length
    ? `role.eq.admin,telegram_id.in.(${envIds.join(',')})`
    : 'role.eq.admin';

  const { data, error } = await admin
    .from('bot_members')
    .select('chat_id')
    .or(roleFilter)
    .not('chat_id', 'is', null);
  if (error) throw error;

  const ids = new Set<number>();
  for (const row of data ?? []) {
    const chatId = (row as { chat_id: number | null }).chat_id;
    if (typeof chatId === 'number') ids.add(chatId);
  }
  return [...ids];
}

// Уведомление о новой заявке каждому администратору с кнопкой открытия.
// Ошибка доставки не откатывает уже сохранённую заявку — вызывающий код
// логирует её и продолжает.
export async function notifyAdminsOfNewLead(admin: SupabaseClient, lead: LeadRow): Promise<number> {
  const shortId = formatShortDisplayId(lead.id);
  const lines = [
    '🔔 *Новая заявка*',
    shortId ? shortId : '',
    leadSourceLabel(lead),
    '',
    `👤 ${lead.name}`,
    `📞 ${lead.contact}`,
  ].filter(Boolean);
  if (lead.teacher) lines.push(`👨‍🏫 ${lead.teacher}`);
  if (lead.service) lines.push(`📚 ${lead.service}`);
  if (lead.grade) lines.push(`🎓 ${lead.grade} класс`);
  if (lead.comment) lines.push(`💬 ${lead.comment}`);
  lines.push('', `🕐 ${formatDateTime(lead.created_at)}`);

  const keyboard = {
    inline_keyboard: [[{ text: '📝 Открыть заявку', callback_data: `al:l:${lead.id}:n:0:a` }]],
  };

  const chatIds = await getAdminChatIds(admin);
  let sent = 0;
  for (const chatId of chatIds) {
    const result = await telegramSend('sendMessage', {
      chat_id: chatId,
      text: lines.join('\n'),
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    if (result.ok) sent += 1;
    else console.error('Не удалось доставить заявку администратору:', result.description);
  }
  return sent;
}
