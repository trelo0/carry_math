import type { AdminHubMetrics } from './hub-metrics';

export type AttentionItem = { text: string; callback: string };

/** Пункты «требует внимания» — только задачи, где нужно действие админа. */
export function buildAttentionItems(metrics: AdminHubMetrics): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (metrics.leadsNew > 0) {
    items.push({
      text: `📨 Новые заявки — ${metrics.leadsNew}`,
      callback: 'ah:go:leads:new',
    });
  }
  if (metrics.purchasesPending > 0) {
    items.push({
      text: `💳 Ожидают оплаты — ${metrics.purchasesPending}`,
      callback: 'ah:go:finance:pending',
    });
  }
  if (metrics.packagesLow > 0) {
    items.push({
      text: `📦 Пакеты заканчиваются — ${metrics.packagesLow}`,
      callback: 'ah:go:finance:packages',
    });
  }
  if (metrics.homeworkLongPending > 0) {
    items.push({
      text: `📝 Домашки долго не проверяются — ${metrics.homeworkLongPending}`,
      callback: 'ah:hw:pending',
    });
  }
  if (metrics.scheduleProblems > 0) {
    items.push({
      text: `📅 Проблемы расписания — ${metrics.scheduleProblems}`,
      callback: 'ah:go:finance:overbook',
    });
  }
  if (metrics.violationsPending > 0) {
    items.push({
      text: `⚠️ Другие проблемы — ${metrics.violationsPending}`,
      callback: 'ah:go:moderation',
    });
  }
  return items;
}
