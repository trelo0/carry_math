import type { SupabaseClient } from '@supabase/supabase-js';
import { formatWebinarDateTime } from '@/lib/webinarReminders';
import { isModerationColumnError } from '@/lib/bot/moderation';
import {
  type AdminMessage,
  type Deliver,
  type InlineKeyboard,
  type Webinar,
  editAdminMessage,
  editDeliver,
  homeButton,
  migrationText,
} from './core';
import {
  type BroadcastHistoryRow,
  formatBroadcastDate,
  isBroadcastTableError,
  listBroadcastHistory,
  summarizeBroadcastHistory,
} from './broadcasts';

// ---------------------------------------------------------------------------
// Статистика
// ---------------------------------------------------------------------------

// Все показатели считаются из существующих таблиц Supabase при каждом
// открытии экрана: bot_members (роли), webinars + webinar_registrations,
// bot_broadcasts (история рассылок), bot_violations (контроль переписки).
// Новых таблиц нет; метрики, для которых в базе нет данных, не показываются.

type StatsPeriod = 'today' | '7d' | '30d' | 'all';

const STATS_PERIODS: Array<{ id: StatsPeriod; label: string }> = [
  { id: 'today', label: 'Сегодня' },
  { id: '7d', label: '7 дней' },
  { id: '30d', label: '30 дней' },
  { id: 'all', label: 'Всё время' },
];

function normalizeStatsPeriod(raw: string | undefined): StatsPeriod {
  return STATS_PERIODS.some((item) => item.id === raw) ? (raw as StatsPeriod) : '7d';
}

// «Сегодня» — от полуночи по Москве (UTC+3), остальные периоды — скользящие.
function statsPeriodStart(period: StatsPeriod): string | null {
  const now = Date.now();
  if (period === 'today') return new Date(now - ((now + 3 * 3600 * 1000) % 86400000)).toISOString();
  if (period === '7d') return new Date(now - 7 * 86400000).toISOString();
  if (period === '30d') return new Date(now - 30 * 86400000).toISOString();
  return null;
}

// Серверный COUNT (head + count:'exact') — строки на клиент не выгружаются.
async function countMembersByRoles(admin: SupabaseClient, roles: string[]): Promise<number> {
  let query = admin.from('bot_members').select('telegram_id', { count: 'exact', head: true });
  if (roles.length === 1) query = query.eq('role', roles[0]);
  if (roles.length > 1) query = query.in('role', roles);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function countMembersSince(admin: SupabaseClient, since: string | null): Promise<number> {
  if (!since) return 0;
  const { count, error } = await admin
    .from('bot_members')
    .select('telegram_id', { count: 'exact', head: true })
    .gte('created_at', since);
  if (error) throw error;
  return count ?? 0;
}

type WebinarStatsSummary = {
  total: number;
  finished: number;
  active: Webinar[];
  nearest: Webinar | null;
};

// Активен = is_active и дата в будущем — та же логика, что в webinarStatus.
async function collectWebinarStats(admin: SupabaseClient): Promise<WebinarStatsSummary> {
  const { data, error } = await admin
    .from('webinars')
    .select('id, title, description, webinar_date, registration_url, is_active')
    .order('webinar_date', { ascending: true })
    .limit(100);
  if (error) throw error;
  const webinars = (data ?? []) as Webinar[];
  const now = Date.now();
  const active = webinars.filter((webinar) => {
    const time = new Date(webinar.webinar_date).getTime();
    return webinar.is_active && !Number.isNaN(time) && time > now;
  });
  const finished = webinars.filter((webinar) => {
    const time = new Date(webinar.webinar_date).getTime();
    return !Number.isNaN(time) && time <= now;
  }).length;
  return { total: webinars.length, finished, active, nearest: active[0] ?? null };
}

async function countRegistrations(
  admin: SupabaseClient,
  webinarId?: string,
  since?: string | null,
): Promise<number> {
  let query = admin.from('webinar_registrations').select('telegram_id', { count: 'exact', head: true });
  if (webinarId) query = query.eq('webinar_id', webinarId);
  if (since) query = query.gte('registered_at', since);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

type ViolationStatsSummary = {
  total: number;
  high: number;
  medium: number;
  low: number;
  warned: number;
  restricted: number;
  blocked: number;
  fromTeachers: number;
  fromCurators: number;
  fromStudents: number;
  usersWithWarnings: number;
};

// Одна выгрузка вместо десятка COUNT: событий модерации немного (лимит 5000).
async function summarizeViolationStats(admin: SupabaseClient): Promise<ViolationStatsSummary | null> {
  const { data, error } = await admin
    .from('bot_violations')
    .select('risk_level, status, sender_role, telegram_id')
    .limit(5000);
  if (error) {
    if (isModerationColumnError(error)) return null;
    throw error;
  }
  const rows = (data ?? []) as Array<{ risk_level: string; status: string; sender_role: string; telegram_id: number }>;
  const warnedUsers = new Set(rows.filter((row) => row.status === 'warned').map((row) => row.telegram_id));
  return {
    total: rows.length,
    high: rows.filter((row) => row.risk_level === 'high').length,
    medium: rows.filter((row) => row.risk_level === 'medium').length,
    low: rows.filter((row) => row.risk_level === 'low').length,
    warned: rows.filter((row) => row.status === 'warned').length,
    restricted: rows.filter((row) => row.status === 'restricted').length,
    blocked: rows.filter((row) => row.status === 'blocked').length,
    fromTeachers: rows.filter((row) => row.sender_role === 'teacher').length,
    fromCurators: rows.filter((row) => row.sender_role === 'curator' || row.sender_role === 'mentor').length,
    fromStudents: rows.filter((row) => row.sender_role === 'student').length,
    usersWithWarnings: warnedUsers.size,
  };
}

async function countBlockedMembers(admin: SupabaseClient): Promise<number | null> {
  const { count, error } = await admin
    .from('bot_members')
    .select('telegram_id', { count: 'exact', head: true })
    .eq('moderation_status', 'blocked');
  if (error) {
    if (isModerationColumnError(error)) return null;
    throw error;
  }
  return count ?? 0;
}

async function countViolationsSince(admin: SupabaseClient, since: string | null): Promise<number | null> {
  if (!since) return null;
  const { count, error } = await admin
    .from('bot_violations')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since);
  if (error) {
    if (isModerationColumnError(error)) return null;
    throw error;
  }
  return count ?? 0;
}

async function countBroadcastsSince(admin: SupabaseClient, since: string | null): Promise<number | null> {
  if (!since) return null;
  const { count, error } = await admin
    .from('bot_broadcasts')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since);
  if (error) {
    if (isBroadcastTableError(error)) return null;
    throw error;
  }
  return count ?? 0;
}

type BroadcastSummary = {
  mailings: number;
  messages: number;
  delivered: number;
  failed: number;
  toUsers: number;
  toAdmins: number;
};

async function getBroadcastSummary(admin: SupabaseClient): Promise<BroadcastSummary | null> {
  try {
    return await summarizeBroadcastHistory(admin);
  } catch (error) {
    if (isBroadcastTableError(error)) return null;
    throw error;
  }
}

function statsKeyboard(period: StatsPeriod): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: '👥 Пользователи', callback_data: 'admin:stats:users' }],
      [{ text: '💳 Оплаты', callback_data: 'admin:stats:paid' }],
      [{ text: '🎓 Ученики', callback_data: 'admin:stats:students' }],
      [{ text: '👨‍🏫 Команда', callback_data: 'admin:stats:team' }],
      [{ text: '📅 Вебинары', callback_data: 'admin:stats:webinars' }],
      [{ text: '📢 Рассылки', callback_data: 'admin:stats:broadcasts' }],
      [{ text: '🚨 Контроль переписки', callback_data: 'admin:stats:moderation' }],
      STATS_PERIODS.map((item) => ({
        text: item.id === period ? `✅ ${item.label}` : item.label,
        callback_data: `admin:stats:home:${item.id}`,
      })),
      [{ text: '🔄 Обновить', callback_data: `admin:stats:home:${period}` }],
      [homeButton()],
    ],
  };
}

function statsSubKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: '⬅️ Назад к статистике', callback_data: 'admin:stats' }],
      [homeButton()],
    ],
  };
}

export async function renderStatsOverview(admin: SupabaseClient, deliver: Deliver, period: StatsPeriod): Promise<void> {
  const since = statsPeriodStart(period);

  const [
    totalMembers, guests, students, teachers, curators, newMembers,
    webinarStats, registrationsTotal, registrationsPeriod,
    broadcastSummary, broadcastsPeriod,
    violationStats, violationsPeriod, blockedMembers,
  ] = await Promise.all([
    countMembersByRoles(admin, []),
    countMembersByRoles(admin, ['guest']),
    countMembersByRoles(admin, ['student']),
    countMembersByRoles(admin, ['teacher']),
    countMembersByRoles(admin, ['curator', 'mentor']),
    countMembersSince(admin, since),
    collectWebinarStats(admin),
    countRegistrations(admin),
    countRegistrations(admin, undefined, since),
    getBroadcastSummary(admin),
    countBroadcastsSince(admin, since),
    summarizeViolationStats(admin),
    countViolationsSince(admin, since),
    countBlockedMembers(admin),
  ]);

  const periodName = STATS_PERIODS.find((item) => item.id === period)?.label ?? '';
  const lines: string[] = ['📊 Общая статистика', ''];

  lines.push('👥 ПОЛЬЗОВАТЕЛИ');
  lines.push(`Всего: ${totalMembers}`);
  lines.push(`❄️ Гости: ${guests} · 💳 Платные: ${students} · 👨‍🏫 Команда: ${teachers + curators}`);
  if (since) lines.push(`Новых пользователей за период: ${newMembers}`);
  lines.push('');

  lines.push('📅 ВЕБИНАРЫ');
  lines.push(`Активных: ${webinarStats.active.length}`);
  lines.push(`Всего регистраций: ${registrationsTotal}`);
  if (since) lines.push(`Регистраций за период: ${registrationsPeriod}`);
  lines.push('');

  lines.push('📢 РАССЫЛКИ');
  if (broadcastSummary) {
    lines.push(`Всего рассылок: ${broadcastSummary.mailings}`);
    lines.push(`Сообщений отправлено: ${broadcastSummary.messages} · ✅ ${broadcastSummary.delivered} · ❌ ${broadcastSummary.failed}`);
    if (broadcastsPeriod !== null) lines.push(`Рассылок за период: ${broadcastsPeriod}`);
  } else {
    lines.push('История рассылок недоступна (нет таблицы bot_broadcasts).');
  }
  lines.push('');

  lines.push('🚨 КОНТРОЛЬ');
  if (violationStats) {
    lines.push(`Нарушений: ${violationStats.total}`);
    lines.push(`Предупреждений: ${violationStats.warned} · Ограничений: ${violationStats.restricted} · Заблокировано: ${blockedMembers ?? violationStats.blocked}`);
    if (violationsPeriod !== null) lines.push(`Нарушений за период: ${violationsPeriod}`);
  } else {
    lines.push('Контроль переписки недоступен (не применена миграция bot_moderation.sql).');
  }
  lines.push('');
  lines.push(`📊 Период: ${periodName}`);

  await deliver(lines.join('\n'), statsKeyboard(period));
}

async function renderStatsUsers(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const [total, guests, students, teachers, curators, admins, testers] = await Promise.all([
    countMembersByRoles(admin, []),
    countMembersByRoles(admin, ['guest']),
    countMembersByRoles(admin, ['student']),
    countMembersByRoles(admin, ['teacher']),
    countMembersByRoles(admin, ['curator', 'mentor']),
    countMembersByRoles(admin, ['admin']),
    countMembersByRoles(admin, ['test']),
  ]);

  const text = [
    '👥 Пользователи',
    '',
    `Всего пользователей: ${total}`,
    '',
    `❄️ Гости: ${guests}`,
    `💳 Платные пользователи: ${students}`,
    `🎓 Ученики: ${students}`,
    `👨‍🏫 Преподаватели: ${teachers}`,
    `🟡 Кураторы (curator + mentor): ${curators}`,
    `🛠 Тестеры: ${testers}`,
    `👑 Администраторы: ${admins}`,
    '',
    'ℹ️ В боте у пользователя одна роль, категории не пересекаются и в сумме дают общее число.',
  ].join('\n');
  await deliver(text, statsSubKeyboard());
}

async function renderStatsPaid(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const students = await countMembersByRoles(admin, ['student']);
  const text = [
    '💳 Оплаты',
    '',
    `💳 Всего платных пользователей: ${students}`,
    '',
    'ℹ️ Платный пользователь = роль student (действующее правило системы).',
    '',
    '⚠️ Таблицы платежей в базе нет: даты, суммы и статусы оплат не хранятся, поэтому «новые оплаты за период» показать невозможно.',
  ].join('\n');
  await deliver(text, statsSubKeyboard());
}

async function renderStatsStudents(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const students = await countMembersByRoles(admin, ['student']);
  const text = [
    '🎓 Ученики',
    '',
    `Всего учеников: ${students}`,
    '',
    '⚠️ Критериев «активный/неактивный/требует внимания» в системе нет: занятия, посещаемость и сроки оплаты не хранятся, поэтому такое деление не показывается.',
  ].join('\n');
  await deliver(text, statsSubKeyboard());
}

async function renderStatsTeam(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const [teachers, curators] = await Promise.all([
    countMembersByRoles(admin, ['teacher']),
    countMembersByRoles(admin, ['curator', 'mentor']),
  ]);
  const text = [
    '👨‍🏫 Команда',
    '',
    `👨‍🏫 Преподаватели: ${teachers}`,
    `🟡 Кураторы (curator + mentor): ${curators}`,
    '',
    '⚠️ Онлайн-статус и активность команды не отслеживаются, поэтому «активны сейчас» определить невозможно.',
  ].join('\n');
  await deliver(text, statsSubKeyboard());
}

async function renderStatsWebinars(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const summary = await collectWebinarStats(admin);
  const registrationsTotal = await countRegistrations(admin);

  const lines: string[] = [
    '📅 Вебинары',
    '',
    `📅 Активных вебинаров: ${summary.active.length}`,
    `Всего проведено: ${summary.finished}`,
    `Всего регистраций: ${registrationsTotal}`,
    '',
  ];

  if (summary.nearest) {
    const nearest = summary.nearest;
    const registered = await countRegistrations(admin, String(nearest.id));
    const when = formatWebinarDateTime(nearest.webinar_date);
    lines.push('Ближайший активный вебинар:');
    lines.push(`Название: ${nearest.title}`);
    lines.push(`Дата: ${when.date}`);
    lines.push(`Время: ${when.time} (МСК)`);
    lines.push(`👥 Зарегистрировано: ${registered}`);
  } else {
    lines.push('Ближайших активных вебинаров нет.');
  }

  await deliver(lines.join('\n'), statsSubKeyboard());
}

async function renderStatsBroadcasts(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  let summary: BroadcastSummary | null;
  let recent: BroadcastHistoryRow[] = [];
  try {
    summary = await summarizeBroadcastHistory(admin);
    recent = (await listBroadcastHistory(admin, 0)).rows;
  } catch (error) {
    if (!isBroadcastTableError(error)) throw error;
    summary = null;
  }

  if (!summary) {
    await deliver(migrationText('bot_broadcasts.sql'), statsSubKeyboard());
    return;
  }

  const lines: string[] = [
    '📢 Рассылки',
    '',
    `📢 Всего рассылок: ${summary.mailings}`,
    `👥 Всего сообщений: ${summary.messages}`,
    `✅ Доставлено: ${summary.delivered}`,
    `❌ Ошибок: ${summary.failed}`,
    `👥 Пользователям: ${summary.toUsers} · 👨‍💼 Администраторам: ${summary.toAdmins}`,
    '',
  ];

  if (recent.length > 0) {
    lines.push('Последние рассылки:');
    for (const row of recent.slice(0, 3)) {
      lines.push(`#${row.id} · ${formatBroadcastDate(row.created_at)} · ${row.audience_title}${row.to_admins ? ' (админам)' : ''} · 👥 ${row.delivered}/${row.recipients} · ❌ ${row.failed}`);
    }
  } else {
    lines.push('Рассылок ещё не было.');
  }

  await deliver(lines.join('\n'), statsSubKeyboard());
}

async function renderStatsModeration(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const [summary, blockedMembers] = await Promise.all([
    summarizeViolationStats(admin),
    countBlockedMembers(admin),
  ]);

  if (!summary) {
    await deliver(migrationText('bot_moderation.sql'), statsSubKeyboard());
    return;
  }

  const text = [
    '🚨 Контроль переписки',
    '',
    `🚨 Всего нарушений: ${summary.total}`,
    `🔴 HIGH: ${summary.high} · 🟠 MEDIUM: ${summary.medium} · 🟡 LOW: ${summary.low}`,
    '',
    `⚠️ Предупреждений: ${summary.warned}`,
    `🚫 Ограничений: ${summary.restricted}`,
    `🔒 Заблокировано пользователей: ${blockedMembers ?? summary.blocked}`,
    '',
    'По отправителям:',
    `👨‍🏫 От преподавателей: ${summary.fromTeachers}`,
    `🟡 От кураторов: ${summary.fromCurators}`,
    `🎓 От учеников: ${summary.fromStudents}`,
    '',
    `Пользователей с предупреждениями: ${summary.usersWithWarnings}`,
    'ℹ️ Автоматического правила «на грани блокировки» в системе нет — санкции назначает администратор вручную.',
  ].join('\n');
  await deliver(text, statsSubKeyboard());
}

// Экраны раздела «📊 Статистика». Всегда возвращает true.
export async function handleStatsAction(admin: SupabaseClient, data: string, message: AdminMessage): Promise<boolean> {
  const section = data.split(':')[2] ?? '';
  const deliver = editDeliver(message);
  try {
    if (section === '' ) {
      await renderStatsOverview(admin, deliver, '7d');
    } else if (section === 'home') {
      await renderStatsOverview(admin, deliver, normalizeStatsPeriod(data.split(':')[3]));
    } else if (section === 'users') {
      await renderStatsUsers(admin, deliver);
    } else if (section === 'paid') {
      await renderStatsPaid(admin, deliver);
    } else if (section === 'students') {
      await renderStatsStudents(admin, deliver);
    } else if (section === 'team') {
      await renderStatsTeam(admin, deliver);
    } else if (section === 'webinars') {
      await renderStatsWebinars(admin, deliver);
    } else if (section === 'broadcasts') {
      await renderStatsBroadcasts(admin, deliver);
    } else if (section === 'moderation') {
      await renderStatsModeration(admin, deliver);
    } else {
      await renderStatsOverview(admin, deliver, '7d');
    }
  } catch (error) {
    if (!isModerationColumnError(error) && !isBroadcastTableError(error)) throw error;
    await editAdminMessage(
      message,
      'Не удалось собрать статистику: не применены миграции Supabase (bot_moderation.sql / bot_broadcasts.sql).',
      statsSubKeyboard(),
    );
  }
  return true;
}
