import type { SupabaseClient } from '@supabase/supabase-js';
import { type Deliver, homeButton } from './core';
import { fetchAdminHubMetrics } from './hub-metrics';
import { collectProblemItems } from './problems-menu';
import { summarizeBroadcastHistory, listBroadcastHistory } from './broadcasts';

export async function renderOperationalReport(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const metrics = await fetchAdminHubMetrics(admin);
  const problems = await collectProblemItems(admin, metrics);

  let broadcastLine = 'Рассылки: нет данных.';
  try {
    const { rows } = await listBroadcastHistory(admin, 0);
    const summary = await summarizeBroadcastHistory(admin);
    broadcastLine = `Рассылки: кампаний ${summary.mailings}, доставлено ${summary.delivered}, ошибок ${summary.failed}.`;
    if (rows.length > 0) {
      broadcastLine += ` Последняя: «${rows[0].audience_title}».`;
    }
  } catch {
    broadcastLine = 'Рассылки: таблица bot_broadcasts не применена.';
  }

  const lines = [
    '📈 Операционный отчёт',
    '',
    'Сводка на сейчас (не ERP, для ежедневного обзора в боте).',
    '',
    'Заявки и финансы:',
    `• Новые заявки: ${metrics.leadsNew}`,
    `• Заявки в работе: ${metrics.leadsInProgress}`,
    `• Ожидают оплаты: ${metrics.purchasesPending}`,
    `• Пакеты ≤2 занятия: ${metrics.packagesLow}`,
    '',
    'Обучение и контроль:',
    `• ДЗ на проверке (занятия): ${metrics.homeworkPendingReview}`,
    `• Нарушения переписки: ${metrics.violationsPending}`,
    `• Новых пользователей за 7 дней: ${metrics.membersNew7d}`,
    '',
    `Проблемы (правила): ${problems.length} пункт(ов)`,
    broadcastLine,
    '',
    'Детали: 🚩 Проблемы, 📊 Статистика, 📢 Рассылки.',
  ];

  await deliver(lines.join('\n'), {
    inline_keyboard: [
      [{ text: '🚩 Проблемы', callback_data: 'ah:problems' }],
      [{ text: '📊 Статистика', callback_data: 'admin:stats' }],
      [{ text: '📢 Рассылки', callback_data: 'admin:broadcasts' }],
      [homeButton()],
    ],
  });
}

export function isReportsHubAction(data: string): boolean {
  return data === 'ah:report:ops';
}
