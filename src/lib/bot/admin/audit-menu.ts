import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type AdminMessage,
  type Deliver,
  type InlineButton,
  editDeliver,
  homeButton,
  homeOnlyKeyboard,
  migrationText,
} from './core';
import {
  formatActionLogLine,
  isActionLogTableError,
  listAdminActionLog,
} from './action-log';

const LOG_PER_PAGE = 8;

export async function renderAuditLogScreen(
  admin: SupabaseClient,
  deliver: Deliver,
  page: number,
): Promise<void> {
  try {
    const { rows, total } = await listAdminActionLog(admin, page, LOG_PER_PAGE);
    const pageCount = Math.max(1, Math.ceil(total / LOG_PER_PAGE));
    const safePage = Math.min(Math.max(0, page), pageCount - 1);

    const lines =
      rows.length === 0
        ? [
            '📜 Журнал действий',
            '',
            total === 0
              ? 'Записей пока нет. Примените supabase/admin_action_log.sql.'
              : 'На этой странице пусто.',
          ]
        : ['📜 Журнал действий', '', ...rows.map((r, i) => `${safePage * LOG_PER_PAGE + i + 1}. ${formatActionLogLine(r)}`)];

    const keyboard: InlineButton[][] = [];
    if (pageCount > 1) {
      keyboard.push([
        {
          text: safePage > 0 ? '⬅️' : '·',
          callback_data: safePage > 0 ? `ah:audit:${safePage - 1}` : 'noop',
        },
        { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
        {
          text: safePage < pageCount - 1 ? '➡️' : '·',
          callback_data: safePage < pageCount - 1 ? `ah:audit:${safePage + 1}` : 'noop',
        },
      ]);
    }
    keyboard.push(
      [{ text: '🚩 Проблемы', callback_data: 'ah:problems' }],
      [{ text: '⬅️ На главную', callback_data: 'ah:home' }],
      [homeButton()],
    );

    await deliver(lines.join('\n'), { inline_keyboard: keyboard });
  } catch (error) {
    if (isActionLogTableError(error)) {
      await deliver(migrationText('admin_action_log.sql'), homeOnlyKeyboard());
      return;
    }
    throw error;
  }
}

export function isAuditHubAction(data: string): boolean {
  return data === 'ah:problems' || data.startsWith('ah:audit:');
}

export async function handleAuditHubAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
): Promise<boolean> {
  const deliver = editDeliver(message);

  if (data === 'ah:problems') {
    const { renderProblemsScreen } = await import('./problems-menu');
    await renderProblemsScreen(admin, deliver);
    return true;
  }

  const auditPage = data.match(/^ah:audit:(\d+)$/);
  if (auditPage) {
    await renderAuditLogScreen(admin, deliver, Number(auditPage[1]) || 0);
    return true;
  }

  return false;
}
