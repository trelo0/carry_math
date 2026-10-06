import type { SupabaseClient } from '@supabase/supabase-js';
import { formatProblemDisplayId } from '@/lib/displayId';
import { countScheduledLessonsForPackage } from '../lesson-credits';
import {
  type AdminMessage,
  type Deliver,
  type InlineButton,
  editDeliver,
  homeButton,
  migrationText,
  homeOnlyKeyboard,
} from './core';
import { fetchAdminHubMetrics, type AdminHubMetrics } from './hub-metrics';
import { buildAttentionItems } from './home-attention';
import {
  countProblemsByStatus,
  countProblemsResolvedToday,
  createAdminProblem,
  getProblem,
  listProblems,
  problemCategoryEmoji,
  problemsTableAvailable,
  resolveAdminProblem,
  resolveOpenProblemsByDedupeKey,
  type ProblemStatus,
} from './problems-data';

const LONG_HW_MS = 3 * 86400000;

export async function countOverbookedPackages(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin
    .from('lesson_packages')
    .select('id, remaining_lessons')
    .eq('status', 'active')
    .limit(100);
  if (error) return 0;
  let n = 0;
  for (const row of data ?? []) {
    const scheduled = await countScheduledLessonsForPackage(admin, row.id as number);
    if (scheduled > (row.remaining_lessons as number)) n += 1;
  }
  return n;
}

async function countLongPendingHomework(admin: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - LONG_HW_MS).toISOString();
  const { count, error } = await admin
    .from('homework_assignments')
    .select('id', { count: 'exact', head: true })
    .in('review_status', ['submitted', 'reviewing'])
    .lt('submitted_at', cutoff);
  if (error) return 0;
  return count ?? 0;
}

export type ProblemItem = { text: string; callback: string };

export async function collectProblemItems(
  admin: SupabaseClient,
  metrics: AdminHubMetrics,
): Promise<ProblemItem[]> {
  const items = [...buildAttentionItems(metrics)];
  const overbook = await countOverbookedPackages(admin);
  if (overbook > 0) {
    items.push({
      text: `⚠️ Перебор: занятий больше остатка (${overbook})`,
      callback: 'ah:go:finance:overbook',
    });
  }
  const hwLong = await countLongPendingHomework(admin);
  if (hwLong > 0) {
    items.push({
      text: `📝 ДЗ на проверке >3 дней (${hwLong})`,
      callback: 'ae:hw:q:long:0',
    });
  }
  return items;
}

function statusEmoji(status: ProblemStatus): string {
  if (status === 'critical') return '🔴';
  if (status === 'resolved') return '🟢';
  return '🟡';
}

export async function renderProblemsScreen(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const metrics = await fetchAdminHubMetrics(admin);
  if (metrics.scheduleProblems > 0) {
    await createAdminProblem(admin, {
      status: 'critical',
      category: 'schedule',
      title: 'Перебор занятий над остатком пакета',
      description: 'Запланировано больше занятий, чем осталось в активных пакетах.',
      openCallback: 'ah:go:finance:overbook',
      dedupeKey: 'schedule-overbook',
    });
  } else {
    await resolveOpenProblemsByDedupeKey(admin, 'schedule-overbook', 0);
  }

  const [criticalN, attentionN, resolvedToday] = await Promise.all([
    countProblemsByStatus(admin, 'critical'),
    countProblemsByStatus(admin, 'attention'),
    countProblemsResolvedToday(admin),
  ]);

  const quickItems = await collectProblemItems(admin, metrics);

  const lines = [
    '🔴 Проблемы',
    '',
    `🔴 Критические — ${criticalN}`,
    `🟡 Требуют внимания — ${attentionN}`,
    `🟢 Решены сегодня — ${resolvedToday}`,
  ];

  if (!(await problemsTableAvailable(admin))) {
    lines.push('', 'ℹ️ Таблица admin_problems не применена — показываем только сводку.');
  }

  const keyboard: InlineButton[][] = [
    [{ text: '🔴 Критические', callback_data: 'ah:prob:list:critical:0' }],
    [{ text: '🟡 Требуют внимания', callback_data: 'ah:prob:list:attention:0' }],
    [{ text: '📋 Все', callback_data: 'ah:prob:list:all:0' }],
  ];

  if (quickItems.length > 0) {
    lines.push('', 'Быстрые переходы:');
    for (const item of quickItems.slice(0, 5)) {
      keyboard.push([{ text: item.text, callback_data: item.callback }]);
    }
  }

  keyboard.push(
    [{ text: '⬅️ Проблемы и контроль', callback_data: 'ah:more:problems-control' }],
    [{ text: '⬅️ Прочее', callback_data: 'ah:more' }],
    [homeButton()],
  );

  await deliver(lines.join('\n'), { inline_keyboard: keyboard });
}

export async function renderProblemsList(
  admin: SupabaseClient,
  deliver: Deliver,
  filter: ProblemStatus | 'all',
  page: number,
): Promise<void> {
  if (!(await problemsTableAvailable(admin))) {
    await deliver(migrationText('admin_problems.sql'), homeOnlyKeyboard());
    return;
  }

  const { rows, total } = await listProblems(admin, filter, page);
  const pageCount = Math.max(1, Math.ceil(total / 6));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);

  const filterTitle =
    filter === 'critical' ? '🔴 Критические' : filter === 'attention' ? '🟡 Требуют внимания' : '📋 Все проблемы';

  const text =
    rows.length === 0
      ? `${filterTitle}\n\nЗаписей нет.`
      : [
          filterTitle,
          '',
          ...rows.map((row) => {
            const when = new Date(row.created_at).toLocaleString('ru-RU', {
              timeZone: 'Europe/Moscow',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            });
            return `${statusEmoji(row.status as ProblemStatus)} ${problemCategoryEmoji(row.category)} ${row.title}\n${when}`;
          }),
        ].join('\n\n');

  const keyboard: InlineButton[][] = rows.map((row) => [
    { text: `${formatProblemDisplayId(row.id)} · ${row.title.slice(0, 40)}`, callback_data: `ah:prob:view:${row.id}` },
  ]);

  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data: safePage > 0 ? `ah:prob:list:${filter}:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data: safePage < pageCount - 1 ? `ah:prob:list:${filter}:${safePage + 1}` : 'noop',
      },
    ]);
  }

  keyboard.push([{ text: '⬅️ Проблемы', callback_data: 'ah:problems' }], [homeButton()]);
  await deliver(text, { inline_keyboard: keyboard });
}

export async function renderProblemDetail(
  admin: SupabaseClient,
  deliver: Deliver,
  id: number,
): Promise<void> {
  const row = await getProblem(admin, id);
  if (!row) {
    await deliver('Проблема не найдена.', {
      inline_keyboard: [[{ text: '⬅️ Проблемы', callback_data: 'ah:problems' }], [homeButton()]],
    });
    return;
  }

  const when = new Date(row.created_at).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  const lines = [
    '🚨 Проблема',
    '',
    `${problemCategoryEmoji(row.category)} ${row.title}`,
    '',
    row.description ?? '',
    '',
    `Создано: ${when}`,
    `Статус: ${statusEmoji(row.status as ProblemStatus)} ${
      row.status === 'critical' ? 'Критическая' : row.status === 'resolved' ? 'Решена' : 'Требует внимания'
    }`,
    '',
    `ID: ${formatProblemDisplayId(row.id)}`,
  ].filter(Boolean);

  const keyboard: InlineButton[][] = [];
  if (row.open_callback) {
    const label =
      row.category === 'finance'
        ? '💳 Открыть'
        : row.category === 'schedule'
          ? '📅 Открыть расписание'
          : '🔗 Перейти';
    keyboard.push([{ text: label, callback_data: row.open_callback }]);
  }
  if (row.status !== 'resolved') {
    keyboard.push([{ text: '✅ Решено', callback_data: `ah:prob:resolve:${row.id}` }]);
  }
  keyboard.push([{ text: '⬅️ Проблемы', callback_data: 'ah:problems' }], [homeButton()]);

  await deliver(lines.join('\n'), { inline_keyboard: keyboard });
}

export function isProblemsAction(data: string): boolean {
  return data === 'ah:problems' || data.startsWith('ah:prob:');
}

export async function handleProblemsAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  const deliver = editDeliver(message);

  if (data === 'ah:problems') {
    await renderProblemsScreen(admin, deliver);
    return true;
  }

  const list = data.match(/^ah:prob:list:(critical|attention|all):(\d+)$/);
  if (list) {
    await renderProblemsList(admin, deliver, list[1] as ProblemStatus | 'all', Number(list[2]) || 0);
    return true;
  }

  const view = data.match(/^ah:prob:view:(\d+)$/);
  if (view) {
    await renderProblemDetail(admin, deliver, Number(view[1]));
    return true;
  }

  const resolve = data.match(/^ah:prob:resolve:(\d+)$/);
  if (resolve) {
    const id = Number(resolve[1]);
    const ok = await resolveAdminProblem(admin, id, telegramId);
    await deliver(ok ? '✅ Проблема отмечена как решённая.' : '⚠️ Не удалось обновить статус.', {
      inline_keyboard: [
        [{ text: '👁 Карточка', callback_data: `ah:prob:view:${id}` }],
        [{ text: '⬅️ Проблемы', callback_data: 'ah:problems' }],
        [homeButton()],
      ],
    });
    return true;
  }

  return false;
}
