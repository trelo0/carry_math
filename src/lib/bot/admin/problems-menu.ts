import type { SupabaseClient } from '@supabase/supabase-js';
import { countScheduledLessonsForPackage } from '../lesson-credits';
import { type Deliver, type InlineButton, homeButton } from './core';
import { fetchAdminHubMetrics, type AdminHubMetrics } from './hub-metrics';
import { buildAttentionItems } from './home-attention';

const LONG_HW_MS = 3 * 86400000;

async function countOverbookedPackages(admin: SupabaseClient): Promise<number> {
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
      callback: 'ah:hw:q:long:0',
    });
  }
  return items;
}

export async function renderProblemsScreen(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const metrics = await fetchAdminHubMetrics(admin);
  const items = await collectProblemItems(admin, metrics);
  const text =
    items.length === 0
      ? '🚩 Проблемы\n\nПо автоматическим правилам всё чисто.'
      : ['🚩 Проблемы', '', 'Сводка attention + аномалии пакетов и ДЗ.', ''].join('\n');
  const keyboard: InlineButton[][] = items.map((item) => [
    { text: item.text, callback_data: item.callback },
  ]);
  keyboard.push(
    [{ text: '📜 Журнал действий', callback_data: 'ah:audit:0' }],
    [{ text: '⬅️ На главную', callback_data: 'ah:home' }],
    [homeButton()],
  );
  await deliver(text, { inline_keyboard: keyboard });
}
