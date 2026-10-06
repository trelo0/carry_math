import type { SupabaseClient } from '@supabase/supabase-js';
import { formatEventDisplayId } from '@/lib/displayId';
import { getMember } from '@/lib/bot/roles';
import {
  type AdminMessage,
  type ConversationState,
  type Deliver,
  type InlineButton,
  editDeliver,
  homeButton,
  homeOnlyKeyboard,
  migrationText,
  saveState,
} from './core';
import {
  type ActionLogCategory,
  type ActionLogPeriod,
  type AdminActionLogRow,
  adminActionFeedLabel,
  buildActionFeedEntry,
  countAdminActionLogToday,
  getAdminActionLogById,
  isActionLogTableError,
  listAdminActionLog,
  normalizeActionLogCategory,
  normalizeActionLogPeriod,
  searchAdminActionLog,
} from './action-log';

const LOG_PER_PAGE = 8;

const FILTER_BUTTONS: Array<{ id: ActionLogCategory; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'people', label: '👤 Люди' },
  { id: 'finance', label: '💳 Финансы' },
  { id: 'lessons', label: '📅 Занятия' },
  { id: 'leads', label: '📨 Заявки' },
  { id: 'system', label: '⚙️ Система' },
];

const PERIOD_BUTTONS: Array<{ id: ActionLogPeriod; label: string }> = [
  { id: 'today', label: 'Сегодня' },
  { id: '7d', label: '7 дней' },
  { id: '30d', label: '30 дней' },
  { id: 'all', label: 'Всё время' },
];

function auditCallback(category: ActionLogCategory, page: number, period: ActionLogPeriod): string {
  return `ah:audit:${category}:${page}:${period}`;
}

function filterKeyboard(
  active: ActionLogCategory,
  page: number,
  pageCount: number,
  safePage: number,
  period: ActionLogPeriod,
  rows: AdminActionLogRow[],
): InlineButton[][] {
  const keyboard: InlineButton[][] = [];
  const row1: InlineButton[] = [];
  const row2: InlineButton[] = [];
  for (const f of FILTER_BUTTONS) {
    const btn: InlineButton = {
      text: f.id === active ? `• ${f.label}` : f.label,
      callback_data: auditCallback(f.id, 0, period),
    };
    if (row1.length < 3) row1.push(btn);
    else row2.push(btn);
  }
  keyboard.push(row1, row2);

  keyboard.push(
    PERIOD_BUTTONS.map((p) => ({
      text: p.id === period ? `• ${p.label}` : p.label,
      callback_data: auditCallback(active, 0, p.id),
    })),
  );

  for (const row of rows) {
    const entry = buildActionFeedEntry(row);
    const label = `${entry.time} · ${entry.title}`.slice(0, 64);
    keyboard.push([{ text: label, callback_data: `ah:audit:ev:${row.id}` }]);
  }

  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data: safePage > 0 ? auditCallback(active, safePage - 1, period) : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data: safePage < pageCount - 1 ? auditCallback(active, safePage + 1, period) : 'noop',
      },
    ]);
  }

  keyboard.push(
    [{ text: '🔎 Найти', callback_data: `ah:audit:search:${active}:${period}` }],
    [{ text: '⬅️ Прочее', callback_data: 'ah:more' }],
    [homeButton()],
  );
  return keyboard;
}

export async function renderAuditLogScreen(
  admin: SupabaseClient,
  deliver: Deliver,
  page: number,
  category: ActionLogCategory = 'all',
  period: ActionLogPeriod = 'all',
): Promise<void> {
  try {
    const todayCount = await countAdminActionLogToday(admin);
    const { rows, total } = await listAdminActionLog(admin, page, LOG_PER_PAGE, category, period);
    const pageCount = Math.max(1, Math.ceil(total / LOG_PER_PAGE));
    const safePage = Math.min(Math.max(0, page), pageCount - 1);

    const header = ['📝 Журнал событий', '', `Сегодня: ${todayCount} событий`, ''];

    const lines =
      rows.length === 0
        ? [
            ...header,
            total === 0
              ? 'Записей пока нет. Важные действия админов и системы будут появляться здесь.'
              : 'На этой странице пусто.',
          ]
        : [
            ...header,
            ...rows.map((r) => {
              const entry = buildActionFeedEntry(r);
              const idLine = entry.eventDisplayId ? `ID: ${entry.eventDisplayId}` : '';
              return [`${entry.time}`, entry.title, entry.subtitle, idLine].filter(Boolean).join('\n');
            }),
          ];

    await deliver(lines.join('\n\n'), {
      inline_keyboard: filterKeyboard(category, safePage, pageCount, safePage, period, rows),
    });
  } catch (error) {
    if (isActionLogTableError(error)) {
      await deliver(migrationText('admin_action_log.sql'), homeOnlyKeyboard());
      return;
    }
    throw error;
  }
}

async function actorLabel(admin: SupabaseClient, telegramId: number): Promise<string> {
  if (telegramId === 0) return '🤖 Система';
  const member = await getMember(admin, telegramId);
  const name = member?.full_name?.trim();
  return name ? `👤 ${name}` : `👤 ID ${telegramId}`;
}

export async function renderAuditEventDetail(
  admin: SupabaseClient,
  deliver: Deliver,
  eventId: string,
): Promise<void> {
  const row = await getAdminActionLogById(admin, eventId);
  if (!row) {
    await deliver('Событие не найдено.', {
      inline_keyboard: [[{ text: '📝 Журнал', callback_data: 'ah:audit:all:0:all' }], [homeButton()]],
    });
    return;
  }

  const entry = buildActionFeedEntry(row);
  const when = new Date(row.created_at).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
  const performer = await actorLabel(admin, row.actor_telegram_id);

  const lines = [
    '📝 Событие',
    '',
    adminActionFeedLabel(row.action),
    '',
    entry.subtitle,
    '',
    `Время: ${when}`,
    `Выполнил: ${performer}`,
    '',
    `ID: ${formatEventDisplayId(row.id) ?? row.id}`,
  ];

  const keyboard: InlineButton[][] = [];
  if (entry.openCallback) {
    keyboard.push([{ text: '🔗 Открыть объект', callback_data: entry.openCallback }]);
  }
  keyboard.push([{ text: '⬅️ Журнал', callback_data: 'ah:audit:all:0:all' }], [homeButton()]);

  await deliver(lines.join('\n'), { inline_keyboard: keyboard });
}

export async function startAuditSearch(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  category: ActionLogCategory,
  period: ActionLogPeriod,
): Promise<void> {
  await saveState(admin, telegramId, message, 'audit:search', { category, auditPeriod: period });
  await editDeliver(message)(
    '🔎 Поиск в журнале\n\nВведите фрагмент ID, тип события или текста из деталей:',
    {
      inline_keyboard: [
        [{ text: '❌ Отмена', callback_data: `ah:audit:${category}:0:${period}` }],
        [homeButton()],
      ],
    },
  );
}

export async function renderAuditSearchResults(
  admin: SupabaseClient,
  state: ConversationState,
  query: string,
): Promise<void> {
  const category = normalizeActionLogCategory(String(state.payload?.category ?? 'all'));
  const period = normalizeActionLogPeriod(String(state.payload?.auditPeriod ?? 'all'));
  const rows = await searchAdminActionLog(admin, query, 10);

  const deliver = editDeliver({ chatId: state.chat_id, messageId: state.message_id });
  if (rows.length === 0) {
    await deliver(`🔎 По запросу «${query.trim()}» ничего не найдено.`, {
      inline_keyboard: [[{ text: '⬅️ Журнал', callback_data: `ah:audit:${category}:0:${period}` }], [homeButton()]],
    });
    return;
  }

  const lines = ['🔎 Результаты поиска', '', ...rows.map((r) => {
    const e = buildActionFeedEntry(r);
    return `${e.time} · ${e.title}\n${e.subtitle}`;
  })];

  const keyboard: InlineButton[][] = rows.map((r) => [
    { text: `👁 ${formatEventDisplayId(r.id) ?? 'Событие'}`, callback_data: `ah:audit:ev:${r.id}` },
  ]);
  keyboard.push([{ text: '⬅️ Журнал', callback_data: `ah:audit:${category}:0:${period}` }], [homeButton()]);

  await deliver(lines.join('\n\n'), { inline_keyboard: keyboard });
}

export function isAuditHubAction(data: string): boolean {
  return (
    data.startsWith('ah:audit:') &&
    (data.startsWith('ah:audit:ev:') ||
      data.startsWith('ah:audit:search:') ||
      /^ah:audit:(all|people|finance|lessons|leads|system):\d+:(all|today|7d|30d)$/.test(data) ||
      /^ah:audit:\d+$/.test(data))
  );
}

function parseAuditCallback(data: string): {
  category: ActionLogCategory;
  page: number;
  period: ActionLogPeriod;
} | null {
  const legacy = data.match(/^ah:audit:(\d+)$/);
  if (legacy) return { category: 'all', page: Number(legacy[1]) || 0, period: 'all' };

  const modern = data.match(
    /^ah:audit:(all|people|finance|lessons|leads|system):(\d+):(all|today|7d|30d)$/,
  );
  if (modern) {
    return {
      category: normalizeActionLogCategory(modern[1]),
      page: Number(modern[2]) || 0,
      period: normalizeActionLogPeriod(modern[3]),
    };
  }

  const legacyCat = data.match(/^ah:audit:(all|people|finance|lessons|leads|system):(\d+)$/);
  if (legacyCat) {
    return {
      category: normalizeActionLogCategory(legacyCat[1]),
      page: Number(legacyCat[2]) || 0,
      period: 'all',
    };
  }

  return null;
}

export async function handleAuditHubAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  const deliver = editDeliver(message);

  const ev = data.match(/^ah:audit:ev:([0-9a-f-]{36})$/i);
  if (ev) {
    await renderAuditEventDetail(admin, deliver, ev[1]);
    return true;
  }

  const search = data.match(/^ah:audit:search:(all|people|finance|lessons|leads|system):(all|today|7d|30d)$/);
  if (search) {
    await startAuditSearch(
      admin,
      telegramId,
      message,
      normalizeActionLogCategory(search[1]),
      normalizeActionLogPeriod(search[2]),
    );
    return true;
  }

  const parsed = parseAuditCallback(data);
  if (parsed) {
    await renderAuditLogScreen(admin, deliver, parsed.page, parsed.category, parsed.period);
    return true;
  }

  return false;
}
