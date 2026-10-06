import type { SupabaseClient } from '@supabase/supabase-js';
import { countViolations, isViolationTableError } from '@/lib/bot/moderation';
import type { Deliver, InlineButton } from './core';
import { homeButton } from './core';
import { fetchAdminHubMetrics } from './hub-metrics';
import { collectProblemItems } from './problems-menu';

export async function renderProblemsControlHub(
  admin: SupabaseClient,
  deliver: Deliver,
): Promise<void> {
  const metrics = await fetchAdminHubMetrics(admin);
  const items = await collectProblemItems(admin, metrics);

  let violationsPending = 0;
  try {
    violationsPending = await countViolations(admin, { status: 'pending' });
  } catch (error) {
    if (!isViolationTableError(error)) throw error;
  }

  const lines = [
    '🚨 Проблемы и контроль',
    '',
    '🔴 Проблемы — ситуации, требующие решения.',
    '💬 Контроль переписки — личные контакты в сообщениях.',
    '',
    `🔴 Проблемы: ${items.length} пункт(ов)`,
    `💬 Новые нарушения: ${violationsPending}`,
  ];

  const keyboard: InlineButton[][] = [
    [{ text: '🔴 Проблемы', callback_data: 'ah:problems' }],
    [{ text: '💬 Контроль переписки', callback_data: 'admin:chat-control' }],
    [{ text: '⬅️ Прочее', callback_data: 'ah:more' }],
    [homeButton()],
  ];

  await deliver(lines.join('\n'), { inline_keyboard: keyboard });
}

export function isProblemsControlHubAction(data: string): boolean {
  return data === 'ah:more:problems-control';
}
