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

// ---------------------------------------------------------------------------
// Раздел админ-панели: заявки с сайта (таблица leads)
// ---------------------------------------------------------------------------

// Статусы заявки. Храним текстом, как и роли бота, чтобы новые статусы
// добавлялись без миграций схемы.
export type LeadStatus = 'new' | 'in_progress' | 'completed' | 'cancelled';

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
};

type LeadStatusMeta = { label: string; emoji: string; code: string };

const LEAD_STATUS_META: Record<LeadStatus, LeadStatusMeta> = {
  new: { label: 'Новая', emoji: '🔴', code: 'n' },
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

const LEAD_COLUMNS =
  'id, created_at, name, contact, comment, teacher, service, grade, rating, rt_score, price, waitlist, spots_status, source, status';

// Счётчики по статусам одним запросом (status выбираем без остальных полей).
async function countLeadsByStatus(
  admin: SupabaseClient,
): Promise<Record<LeadStatus, number> & { all: number }> {
  const counts: Record<LeadStatus, number> & { all: number } = {
    new: 0,
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
): Promise<{ leads: LeadRow[]; total: number }> {
  const from = page * LEADS_PER_PAGE;
  let query = admin.from('leads').select(LEAD_COLUMNS, { count: 'exact' });
  if (filter !== 'all') query = query.eq('status', filter);
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + LEADS_PER_PAGE - 1);
  if (error) throw error;
  return { leads: (data ?? []) as LeadRow[], total: count ?? 0 };
}

async function getLead(admin: SupabaseClient, id: string): Promise<LeadRow | null> {
  if (!UUID_RE.test(id)) return null;
  const { data, error } = await admin.from('leads').select(LEAD_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? (data as LeadRow) : null;
}

async function setLeadStatus(
  admin: SupabaseClient,
  id: string,
  status: LeadStatus,
): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const { data, error } = await admin
    .from('leads')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
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
  const lines = [`${index}. ${lead.name}`, `📞 ${lead.contact}`];
  const service = leadServiceLine(lead);
  if (service) lines.push(service);
  lines.push(`🕐 ${formatTime(lead.created_at)}`);
  return lines.join('\n');
}

function countsHeader(counts: Record<LeadStatus, number> & { all: number }): string {
  return [
    `${LEAD_STATUS_META.new.emoji} Новые (${counts.new})`,
    `${LEAD_STATUS_META.in_progress.emoji} В работе (${counts.in_progress})`,
    `${LEAD_STATUS_META.completed.emoji} Выполненные (${counts.completed})`,
    `${LEAD_STATUS_META.cancelled.emoji} Отменённые (${counts.cancelled})`,
    `📋 Всего (${counts.all})`,
  ].join('\n');
}

function filterKeyboard(current: LeadFilter): InlineButton[][] {
  const button = (filter: LeadFilter, label: string): InlineButton => ({
    text: `${filter === current ? '✅ ' : ''}${label}`,
    callback_data: `al:f:${codeFromFilter(filter)}:0`,
  });
  return [
    [button('new', '🔴 Новые'), button('in_progress', '🟡 В работе')],
    [button('completed', '🟢 Выполненные'), button('cancelled', '⚫ Отменённые')],
    [button('all', '📋 Все')],
  ];
}

// Экран списка заявок: счётчики, страница выбранного фильтра и навигация.
async function renderLeadsScreen(
  admin: SupabaseClient,
  deliver: Deliver,
  filter: LeadFilter,
  page: number,
): Promise<void> {
  const counts = await countLeadsByStatus(admin);
  const { leads, total } = await listLeads(admin, filter, page);
  const pageCount = Math.max(1, Math.ceil(total / LEADS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);

  const keyboard: InlineButton[][] = filterKeyboard(filter);
  keyboard.push(
    ...leads.map((lead) => [
      {
        text: `👤 ${shorten(lead.name, 32)}`,
        callback_data: `al:l:${lead.id}:${codeFromFilter(filter)}:${safePage}`,
      },
    ]),
  );

  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️ Назад' : '·',
        callback_data: safePage > 0 ? `al:f:${codeFromFilter(filter)}:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️ Далее' : '·',
        callback_data: safePage < pageCount - 1 ? `al:f:${codeFromFilter(filter)}:${safePage + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push([homeButton()]);

  const title = filter === 'all' ? '📋 Все заявки' : `${statusMetaOfFilter(filter)} Заявки`;
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
export async function renderLeadsMenu(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  await renderLeadsScreen(admin, deliver, 'new', 0);
}

// Карточка одной заявки со сменой статуса.
async function renderLeadDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  lead: LeadRow,
  filter: LeadFilter,
  page: number,
): Promise<void> {
  const meta = statusMeta(lead);
  const lines = [
    `📝 Заявка`,
    '',
    `👤 ${lead.name}`,
    `📞 ${lead.contact}`,
  ];
  if (lead.teacher) lines.push(`👨🏫 ${lead.teacher}`);
  if (lead.service) lines.push(`📚 ${lead.service}`);
  if (lead.grade) lines.push(`🎓 ${lead.grade} класс`);
  if (lead.rating) lines.push(`📈 Оценка: ${lead.rating}`);
  if (lead.rt_score) lines.push(`🎯 Балл РТ: ${lead.rt_score}`);
  if (lead.price) lines.push(`💳 ${lead.price}`);
  if (lead.comment) lines.push(`💬 ${lead.comment}`);
  lines.push('', `🕐 ${formatDateTime(lead.created_at)}`, '', `Статус: ${meta.emoji} ${meta.label}`);

  const back = { text: '◀️ К заявкам', callback_data: `al:f:${codeFromFilter(filter)}:${page}` };
  const keyboard: InlineButton[][] = (Object.keys(LEAD_STATUS_META) as LeadStatus[])
    .filter((status) => status !== statusOf(lead))
    .map((status) => [
      {
        text: `${LEAD_STATUS_META[status].emoji} ${LEAD_STATUS_META[status].label}`,
        callback_data: `al:s:${lead.id}:${LEAD_STATUS_META[status].code}:${codeFromFilter(filter)}:${page}`,
      },
    ]);
  keyboard.push([back], [homeButton()]);

  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
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
): Promise<boolean> {
  const deliver = editDeliver(message);

  try {
    if (data === 'al:menu') {
      await renderLeadsMenu(admin, deliver);
      return true;
    }

    // al:f:<фильтр>:<страница>
    if (data.startsWith('al:f:')) {
      const [, , filterCode, pageRaw] = data.split(':');
      await renderLeadsScreen(admin, deliver, filterFromCode(filterCode), Math.max(0, Number(pageRaw) || 0));
      return true;
    }

    // al:l:<id>:<фильтр>:<страница>
    if (data.startsWith('al:l:')) {
      const [, , id, filterCode, pageRaw] = data.split(':');
      const lead = await getLead(admin, id);
      if (!lead) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await renderLeadDetail(admin, message, lead, filterFromCode(filterCode), Math.max(0, Number(pageRaw) || 0));
      return true;
    }

    // al:s:<id>:<статус>:<фильтр>:<страница>
    if (data.startsWith('al:s:')) {
      const [, , id, statusCode, filterCode, pageRaw] = data.split(':');
      const status = (Object.keys(LEAD_STATUS_META) as LeadStatus[]).find(
        (key) => LEAD_STATUS_META[key].code === statusCode,
      );
      const filter = filterFromCode(filterCode);
      const page = Math.max(0, Number(pageRaw) || 0);
      if (status) await setLeadStatus(admin, id, status);
      const lead = await getLead(admin, id);
      if (!lead) {
        await deliver('Заявка не найдена.', { inline_keyboard: [[homeButton()]] });
        return true;
      }
      await renderLeadDetail(admin, message, lead, filter, page);
      return true;
    }
  } catch (error) {
    if (isLeadStatusColumnError(error)) {
      await deliver(migrationText('leads_status.sql'), homeOnlyKeyboard());
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
  const lines = ['🔔 *Новая заявка*', '', `👤 ${lead.name}`, `📞 ${lead.contact}`];
  if (lead.teacher) lines.push(`👨‍🏫 ${lead.teacher}`);
  if (lead.service) lines.push(`📚 ${lead.service}`);
  if (lead.grade) lines.push(`🎓 ${lead.grade} класс`);
  if (lead.comment) lines.push(`💬 ${lead.comment}`);
  lines.push('', `🕐 ${formatDateTime(lead.created_at)}`);

  const keyboard = {
    inline_keyboard: [[{ text: '📝 Открыть заявку', callback_data: `al:l:${lead.id}:n:0` }]],
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
