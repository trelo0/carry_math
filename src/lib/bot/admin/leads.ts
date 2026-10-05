import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  type AdminMessage,
  type Deliver,
  type InlineButton,
  editAdminMessage,
  editDeliver,
  homeButton,
  migrationText,
  homeOnlyKeyboard,
  shorten,
} from './core';
import { logAdminAction } from './action-log';

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

const LEADS_PER_PAGE = 5;

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
  'id, created_at, name, contact, comment, teacher, service, grade, rating, rt_score, price, waitlist, spots_status, source, status, assigned_telegram_id';

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
  const { data, error } = await admin.from('leads').select('status').limit(1000);
  if (error) throw error;
  for (const row of data ?? []) {
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

async function getLead(admin: SupabaseClient, id: string, columns: string): Promise<LeadRow | null> {
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

async function setLeadStatus(
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

async function resolveLinkedTelegramId(admin: SupabaseClient, lead: LeadRow): Promise<number | null> {
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

function leadCard(lead: LeadRow, index: number): string {
  const meta = statusMeta(lead);
  const lines = [`${index}. ${meta.emoji} ${lead.name}`, leadSourceLabel(lead), `📞 ${lead.contact}`];
  const service = leadServiceLine(lead);
  if (service) lines.push(service);
  lines.push(`🕐 ${formatTime(lead.created_at)}`);
  return lines.join('\n');
}

function countsHeader(counts: Record<LeadStatus, number> & { all: number }): string {
  return [
    `${LEAD_STATUS_META.new.emoji} Новые (${counts.new})`,
    `${LEAD_STATUS_META.awaiting_reply.emoji} Ожидают ответа (${counts.awaiting_reply})`,
    `${LEAD_STATUS_META.in_progress.emoji} В работе (${counts.in_progress})`,
    `${LEAD_STATUS_META.completed.emoji} Выполненные (${counts.completed})`,
    `${LEAD_STATUS_META.cancelled.emoji} Отменённые (${counts.cancelled})`,
    `📋 Всего (${counts.all})`,
  ].join('\n');
}

function listNavSuffix(filter: LeadFilter, page: number, source: LeadSourceFilter): string {
  return `${codeFromFilter(filter)}:${page}:${codeFromSource(source)}`;
}

function filterKeyboard(current: LeadFilter, source: LeadSourceFilter): InlineButton[][] {
  const button = (filter: LeadFilter, label: string): InlineButton => ({
    text: `${filter === current ? '✅ ' : ''}${label}`,
    callback_data: `al:f:${listNavSuffix(filter, 0, source)}`,
  });
  const srcBtn = (src: LeadSourceFilter, label: string): InlineButton => ({
    text: `${source === src ? '✅ ' : ''}${label}`,
    callback_data: `al:so:${codeFromSource(src)}:${codeFromFilter(current)}:0`,
  });
  return [
    [srcBtn('all', '📋 Все источники'), srcBtn('telegram', '✈️ Telegram'), srcBtn('site', '🌐 Сайт')],
    [button('new', '🔴 Новые'), button('awaiting_reply', '💬 Ждут ответа')],
    [button('in_progress', '🟡 В работе'), button('completed', '🟢 Готово')],
    [button('cancelled', '⚫ Отменённые'), button('all', '📋 Все статусы')],
  ];
}

let leadColumnsCache: string | null = null;

async function resolveLeadColumns(admin: SupabaseClient): Promise<string> {
  if (leadColumnsCache) return leadColumnsCache;
  const { error } = await admin.from('leads').select('assigned_telegram_id').limit(1);
  leadColumnsCache =
    error && isLeadPhase3ColumnError(error) ? LEAD_COLUMNS_LEGACY : LEAD_SELECT_COLUMNS;
  return leadColumnsCache;
}

// Экран списка заявок: счётчики, страница выбранного фильтра и навигация.
async function renderLeadsScreen(
  admin: SupabaseClient,
  deliver: Deliver,
  filter: LeadFilter,
  page: number,
  source: LeadSourceFilter = 'all',
): Promise<void> {
  const columns = await resolveLeadColumns(admin);
  const counts = await countLeadsByStatus(admin);
  const { leads, total } = await listLeads(admin, filter, page, source, columns);
  const pageCount = Math.max(1, Math.ceil(total / LEADS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const nav = listNavSuffix(filter, safePage, source);

  const keyboard: InlineButton[][] = filterKeyboard(filter, source);
  keyboard.push(
    ...leads.map((lead) => [
      {
        text: `${statusMeta(lead).emoji} ${shorten(lead.name, 28)}`,
        callback_data: `al:l:${lead.id}:${nav}`,
      },
    ]),
  );

  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️ Назад' : '·',
        callback_data: safePage > 0 ? `al:f:${listNavSuffix(filter, safePage - 1, source)}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️ Далее' : '·',
        callback_data:
          safePage < pageCount - 1 ? `al:f:${listNavSuffix(filter, safePage + 1, source)}` : 'noop',
      },
    ]);
  }
  keyboard.push([homeButton()]);

  const sourceHint =
    source === 'telegram' ? ' (Telegram)' : source === 'site' ? ' (сайт)' : '';
  const title = filter === 'all' ? `📋 Все заявки${sourceHint}` : `${statusMetaOfFilter(filter)} Заявки${sourceHint}`;
  const text =
    total === 0
      ? `📝 Заявки\n\n${countsHeader(counts)}\n\n${title}: пока пусто.`
      : [
          '📝 Заявки',
          '',
          countsHeader(counts),
          '',
          ...leads.map((lead, index) => leadCard(lead, safePage * LEADS_PER_PAGE + index + 1)),
        ].join('\n');

  await deliver(text, { inline_keyboard: keyboard });
}

function statusMetaOfFilter(filter: LeadFilter): string {
  return filter === 'all' ? '📋' : LEAD_STATUS_META[filter].emoji;
}

// Меню раздела: из Reply Keyboard приходит новым сообщением.
export async function renderLeadsMenu(
  admin: SupabaseClient,
  deliver: Deliver,
  filter: LeadFilter = 'new',
  source: LeadSourceFilter = 'all',
): Promise<void> {
  await renderLeadsScreen(admin, deliver, filter, 0, source);
}

function parseListContext(parts: string[]): {
  filter: LeadFilter;
  page: number;
  source: LeadSourceFilter;
} {
  const filter = filterFromCode(parts[0]);
  const page = Math.max(0, Number(parts[1]) || 0);
  const source = sourceFromCode(parts[2]);
  return { filter, page, source };
}

// Карточка одной заявки со сменой статуса.
async function renderLeadDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  lead: LeadRow,
  filter: LeadFilter,
  page: number,
  source: LeadSourceFilter,
  _actorTelegramId: number,
): Promise<void> {
  const meta = statusMeta(lead);
  const nav = listNavSuffix(filter, page, source);
  const lines = [`📝 Заявка`, '', leadSourceLabel(lead), `👤 ${lead.name}`, `📞 ${lead.contact}`];
  if (lead.teacher) lines.push(`👨🏫 ${lead.teacher}`);
  if (lead.service) lines.push(`📚 ${lead.service}`);
  if (lead.grade) lines.push(`🎓 ${lead.grade} класс`);
  if (lead.rating) lines.push(`📈 Оценка: ${lead.rating}`);
  if (lead.rt_score) lines.push(`🎯 Балл РТ: ${lead.rt_score}`);
  if (lead.price) lines.push(`💳 ${lead.price}`);
  const commentForDisplay = lead.comment?.replace(/telegram_id:\d+\s*/g, '').trim();
  if (commentForDisplay) lines.push(`💬 ${commentForDisplay}`);
  lines.push('', `🕐 ${formatDateTime(lead.created_at)}`, '', `Статус: ${meta.emoji} ${meta.label}`);

  if (lead.assigned_telegram_id != null) {
    lines.push(`👔 Ответственный: ${await memberDisplayName(admin, lead.assigned_telegram_id)}`);
  } else {
    lines.push('👔 Ответственный: не назначен');
  }

  const history = await loadLeadStatusHistory(admin, lead.id);
  if (history.length > 0) {
    lines.push('', 'История статусов:');
    for (const row of history) {
      const hMeta =
        row.status in LEAD_STATUS_META
          ? LEAD_STATUS_META[row.status as LeadStatus]
          : { emoji: '•', label: row.status };
      const who =
        row.changed_by_telegram_id != null
          ? await memberDisplayName(admin, row.changed_by_telegram_id)
          : '—';
      lines.push(`  ${hMeta.emoji} ${hMeta.label} · ${formatDateTime(row.created_at)} · ${who}`);
    }
  }

  const linkedId = await resolveLinkedTelegramId(admin, lead);
  const keyboard: InlineButton[][] = (Object.keys(LEAD_STATUS_META) as LeadStatus[])
    .filter((status) => status !== statusOf(lead))
    .map((status) => [
      {
        text: `${LEAD_STATUS_META[status].emoji} ${LEAD_STATUS_META[status].label}`,
        callback_data: `al:s:${lead.id}:${LEAD_STATUS_META[status].code}:${nav}`,
      },
    ]);

  const assignRow: InlineButton[] = [
    { text: '👔 Назначить', callback_data: `al:as:${lead.id}:${nav}` },
    { text: '👤 На меня', callback_data: `al:me:${lead.id}:${nav}` },
  ];
  if (lead.assigned_telegram_id != null) {
    assignRow.push({ text: '✖️ Снять', callback_data: `al:ac:${lead.id}:${nav}` });
  }
  keyboard.push(assignRow);

  if (linkedId != null) {
    keyboard.push([{ text: '🔗 Карточка человека', callback_data: `admin:user:${linkedId}::` }]);
  }

  const back = { text: '◀️ К заявкам', callback_data: `al:f:${nav}` };
  keyboard.push([back], [homeButton()]);

  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

async function renderLeadAssignPicker(
  admin: SupabaseClient,
  message: AdminMessage,
  lead: LeadRow,
  filter: LeadFilter,
  page: number,
  source: LeadSourceFilter,
): Promise<void> {
  const nav = listNavSuffix(filter, page, source);
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
    if (data === 'al:menu') {
      await renderLeadsMenu(admin, deliver);
      return true;
    }

    // al:so:<источник>:<фильтр>:<страница>
    if (data.startsWith('al:so:')) {
      const [, , srcCode, filterCode, pageRaw] = data.split(':');
      await renderLeadsScreen(
        admin,
        deliver,
        filterFromCode(filterCode),
        Math.max(0, Number(pageRaw) || 0),
        sourceFromCode(srcCode),
      );
      return true;
    }

    // al:f:<фильтр>:<страница>[:источник]
    if (data.startsWith('al:f:')) {
      const parts = data.slice('al:f:'.length).split(':');
      const ctx = parseListContext(parts);
      await renderLeadsScreen(admin, deliver, ctx.filter, ctx.page, ctx.source);
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
      await renderLeadDetail(admin, message, lead, ctx.filter, ctx.page, ctx.source, actorTelegramId);
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
      await renderLeadAssignPicker(admin, message, lead, ctx.filter, ctx.page, ctx.source);
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
      await renderLeadDetail(admin, message, lead, ctx.filter, ctx.page, ctx.source, actorTelegramId);
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
      await renderLeadDetail(admin, message, lead, ctx.filter, ctx.page, ctx.source, actorTelegramId);
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
      await renderLeadDetail(admin, message, lead, ctx.filter, ctx.page, ctx.source, actorTelegramId);
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
      await renderLeadDetail(admin, message, lead, ctx.filter, ctx.page, ctx.source, actorTelegramId);
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
  const lines = ['🔔 *Новая заявка*', leadSourceLabel(lead), '', `👤 ${lead.name}`, `📞 ${lead.contact}`];
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
