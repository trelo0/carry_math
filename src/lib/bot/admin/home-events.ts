import type { SupabaseClient } from '@supabase/supabase-js';
import { formatShortDisplayId } from '@/lib/displayId';
import { getMember } from '@/lib/bot/roles';
import { listAdminActionLog, type AdminActionLogRow } from './action-log';
import { memberDisplayName } from './users';

export type SchoolFeedEvent = {
  at: string;
  timeLabel: string;
  title: string;
  subtitle: string;
  openCallback: string | null;
};

/** Действия админов в журнале — не показываем на главной (назначения, смена статусов). */
const HIDDEN_LOG_ACTIONS = new Set([
  'lead.status',
  'lead.assignee',
  'user.role',
  'user.extra_add',
  'user.extra_remove',
  'package.adjust',
  'package.sync',
]);

const VISIBLE_LOG_ACTIONS = new Set([
  'purchase.approve',
  'purchase.reject',
  'lesson.cancel',
  'lesson.reschedule',
]);

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function memberName(admin: SupabaseClient, telegramId: number | null | undefined): Promise<string | null> {
  if (!telegramId) return null;
  const m = await getMember(admin, telegramId);
  if (!m) return null;
  const name = memberDisplayName(m).trim();
  return name.startsWith('ID ') ? null : name;
}

function logRowToEvent(row: AdminActionLogRow, subtitle: string, openCallback: string | null): SchoolFeedEvent {
  const titles: Record<string, string> = {
    'purchase.approve': '💳 Получена оплата',
    'purchase.reject': '💳 Оплата отклонена',
    'lesson.cancel': '📅 Занятие отменено',
    'lesson.reschedule': '📅 Занятие перенесено',
  };
  return {
    at: row.created_at,
    timeLabel: timeLabel(row.created_at),
    title: titles[row.action] ?? '🔔 Событие',
    subtitle,
    openCallback,
  };
}

async function eventsFromActionLog(admin: SupabaseClient, limit: number): Promise<SchoolFeedEvent[]> {
  const { rows } = await listAdminActionLog(admin, 0, 30);
  const out: SchoolFeedEvent[] = [];
  for (const row of rows) {
    if (HIDDEN_LOG_ACTIONS.has(row.action)) continue;
    if (!VISIBLE_LOG_ACTIONS.has(row.action)) continue;

    let subtitle = '';
    let openCallback: string | null = null;
    const shortId = formatShortDisplayId(row.entity_id);
    const person = await memberName(admin, row.target_telegram_id);

    if (row.action.startsWith('purchase.')) {
      subtitle = person ? person : shortId ? `Оплата ${shortId}` : 'Оплата';
      if (row.entity_id) openCallback = `ap:l:${row.entity_id}:p:0`;
    } else if (row.action.startsWith('lesson.')) {
      subtitle = person ?? (shortId ? `Занятие ${shortId}` : 'Занятие');
      const lessonId = Number(row.entity_id);
      if (Number.isFinite(lessonId)) openCallback = `ae:ls:l:${lessonId}:0:0`;
    }

    out.push(logRowToEvent(row, subtitle, openCallback));
    if (out.length >= limit) break;
  }
  return out;
}

async function eventsFromNewLeads(admin: SupabaseClient, limit: number): Promise<SchoolFeedEvent[]> {
  const out: SchoolFeedEvent[] = [];
  try {
    const { data, error } = await admin
      .from('leads')
      .select('id, name, created_at, source')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return out;
    for (const lead of data ?? []) {
      const name = String(lead.name ?? '').trim() || 'Без имени';
      const shortId = formatShortDisplayId(String(lead.id));
      const src = String(lead.source ?? '').includes('telegram') ? 'Telegram' : 'Сайт';
      out.push({
        at: String(lead.created_at),
        timeLabel: timeLabel(String(lead.created_at)),
        title: '📨 Новая заявка',
        subtitle: `${name} · ${src}${shortId ? ` · ${shortId}` : ''}`,
        openCallback: `al:l:${lead.id as string}:n:0:a`,
      });
    }
  } catch {
    /* leads table */
  }
  return out;
}

/** Лента «последние события» — заявки, оплаты, занятия; без журнала действий админов. */
export async function fetchSchoolRecentEvents(
  admin: SupabaseClient,
  limit = 5,
): Promise<SchoolFeedEvent[]> {
  const [fromLeads, fromLog] = await Promise.all([
    eventsFromNewLeads(admin, limit),
    eventsFromActionLog(admin, limit),
  ]);
  const merged = [...fromLeads, ...fromLog].sort((a, b) => (a.at < b.at ? 1 : -1));
  const seen = new Set<string>();
  const unique: SchoolFeedEvent[] = [];
  for (const ev of merged) {
    const key = `${ev.title}|${ev.subtitle}|${ev.timeLabel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ev);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function formatSchoolEventsBlock(events: SchoolFeedEvent[]): string[] {
  const lines = ['🔔 ПОСЛЕДНИЕ СОБЫТИЯ', ''];
  if (events.length === 0) {
    lines.push('Пока нет новых событий.');
    return lines;
  }
  for (const ev of events) {
    lines.push(ev.timeLabel, ev.title, ev.subtitle, '');
  }
  return lines.slice(0, -1);
}
