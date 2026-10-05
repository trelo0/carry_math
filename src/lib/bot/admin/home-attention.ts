import type { AdminHubMetrics } from './hub-metrics';

export type AttentionItem = { text: string; callback: string };

/** Пункты «требует внимания» по счётчикам hub (фаза 1 + расширения). */
export function buildAttentionItems(metrics: AdminHubMetrics): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (metrics.leadsNew > 0) {
    items.push({ text: `📨 Новая заявка — обработать (${metrics.leadsNew})`, callback: 'ah:go:leads:new' });
  }
  if (metrics.leadsInProgress > 0) {
    items.push({
      text: `📨 Заявки в работе (${metrics.leadsInProgress})`,
      callback: 'ah:go:leads:progress',
    });
  }
  if (metrics.purchasesPending > 0) {
    items.push({
      text: `💳 Подтвердить оплату (${metrics.purchasesPending})`,
      callback: 'ah:go:finance:pending',
    });
  }
  if (metrics.packagesLow > 0) {
    items.push({
      text: `📦 Пакеты заканчиваются (${metrics.packagesLow})`,
      callback: 'ah:go:finance:packages',
    });
  }
  if (metrics.homeworkPendingReview > 0) {
    items.push({
      text: `📝 ДЗ на проверке — ${metrics.homeworkPendingReview}`,
      callback: 'ah:hw:pending',
    });
  }
  if (metrics.violationsPending > 0) {
    items.push({
      text: `🚨 Нарушения переписки (${metrics.violationsPending})`,
      callback: 'ah:go:moderation',
    });
  }
  return items;
}
