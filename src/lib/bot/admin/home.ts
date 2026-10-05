import type { SupabaseClient } from '@supabase/supabase-js';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import {
  type AdminMessage,
  type Deliver,
  type InlineButton,
  editAdminMessage,
  editDeliver,
  homeButton,
  saveState,
  sendAdminMessage,
} from './core';
import { attentionTaskCount, fetchAdminHubMetrics, type AdminHubMetrics } from './hub-metrics';
import { renderMoreMenu } from './more-menu';
import { renderPeopleMenu } from './people-menu';
import { renderLeadsMenu } from './leads';
import { renderPurchasesMenu } from './purchases';
import { renderPackagesMenu } from './packages-menu';
import { renderEducationMenu } from './education-ops';
import { renderModerationMenu } from './moderation';
import { renderStaffList, renderStaffProfile } from './staff-catalog';
import { getMemberWithExtras } from './staff-roster';
import {
  renderStudentsHub,
  renderStudentFilterList,
  renderTeacherPickerForStudents,
  type StudentFilterId,
} from './student-catalog';
import { handleCommsHubAction, isCommsHubAction } from './comms-ops';
import { buildAttentionItems } from './home-attention';
import { handleAuditHubAction, isAuditHubAction } from './audit-menu';
import { renderOperationalReport } from './reports-ops';
import { formatActionLogLine, listAdminActionLog } from './action-log';

export function isHubAction(data: string): boolean {
  return data.startsWith('ah:');
}

function metricLine(label: string, value: number, suffix = ''): string {
  if (value <= 0) return '';
  return `• ${label}: ${value}${suffix}`;
}

function buildHomeText(metrics: AdminHubMetrics): string {
  const attention = attentionTaskCount(metrics);
  const lines = [
    '🏠 Главная',
    '',
    attention > 0 ? `⚡ Требует внимания: ${attention} пункт(ов)` : '✅ Срочных задач по счётчикам нет.',
    '',
    'Показатели:',
    metricLine('Новые заявки', metrics.leadsNew),
    metricLine('Заявки в работе', metrics.leadsInProgress),
    metricLine('Ожидают оплаты', metrics.purchasesPending),
    metricLine('Нарушения (новые)', metrics.violationsPending),
    metricLine('Пакеты ≤2 занятия', metrics.packagesLow),
    metricLine('ДЗ на проверке (занятия)', metrics.homeworkPendingReview),
    metricLine('Новых пользователей за 7 дней', metrics.membersNew7d),
  ].filter(Boolean);
  return lines.join('\n');
}

function homeKeyboard(metrics: AdminHubMetrics): InlineButton[][] {
  const rows: InlineButton[][] = [
    [{ text: '⚡ Требует внимания', callback_data: 'ah:attention' }],
    [{ text: '🔔 События', callback_data: 'ah:events' }],
    [{ text: '🔎 Поиск человека', callback_data: 'ah:search' }],
  ];
  if (metrics.leadsNew > 0) {
    rows.push([{ text: `📨 Новые заявки (${metrics.leadsNew})`, callback_data: 'ah:go:leads:new' }]);
  }
  if (metrics.purchasesPending > 0) {
    rows.push([
      { text: `💳 Ожидают оплаты (${metrics.purchasesPending})`, callback_data: 'ah:go:finance:pending' },
    ]);
  }
  if (metrics.violationsPending > 0) {
    rows.push([
      { text: `🚨 Нарушения (${metrics.violationsPending})`, callback_data: 'ah:go:moderation' },
    ]);
  }
  rows.push([homeButton()]);
  return rows;
}

export async function renderAdminHomeDashboard(
  admin: SupabaseClient,
  deliver: Deliver,
): Promise<void> {
  const metrics = await fetchAdminHubMetrics(admin);
  await deliver(buildHomeText(metrics), { inline_keyboard: homeKeyboard(metrics) });
}

async function renderAttentionScreen(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const metrics = await fetchAdminHubMetrics(admin);
  const items = buildAttentionItems(metrics);
  const text =
    items.length === 0
      ? '⚡ Требует внимания\n\nСейчас нет пунктов по автоматическим счётчикам.'
      : ['⚡ Требует внимания', '', 'Нажми пункт — откроется нужный раздел.', ''].join('\n');
  const keyboard: InlineButton[][] = items.map((item) => [{ text: item.text, callback_data: item.callback }]);
  keyboard.push(
    [{ text: '🚩 Все проблемы', callback_data: 'ah:problems' }],
    [{ text: '⬅️ На главную', callback_data: 'ah:home' }],
    [homeButton()],
  );
  await deliver(text, { inline_keyboard: keyboard });
}

async function renderEventsScreen(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const metrics = await fetchAdminHubMetrics(admin);
  const { rows: logRows } = await listAdminActionLog(admin, 0, 5);
  const lines = [
    '🔔 События',
    '',
    'Счётчики:',
    `📨 Заявки: новых ${metrics.leadsNew}, в работе ${metrics.leadsInProgress}`,
    `💳 Оплат ожидает: ${metrics.purchasesPending}`,
    `📦 Пакетов ≤2: ${metrics.packagesLow}`,
    `📝 ДЗ на проверке: ${metrics.homeworkPendingReview}`,
    `🚨 Нарушений: ${metrics.violationsPending}`,
    `👥 Новых за 7 дней: ${metrics.membersNew7d}`,
    '',
    logRows.length > 0 ? 'Последние действия админов:' : 'Журнал действий пока пуст (admin_action_log.sql).',
    ...logRows.map((r) => `• ${formatActionLogLine(r)}`),
  ];
  await deliver(lines.join('\n'), {
    inline_keyboard: [
      [{ text: '📜 Полный журнал', callback_data: 'ah:audit:0' }],
      [{ text: '🚩 Проблемы', callback_data: 'ah:problems' }],
      [{ text: '⬅️ На главную', callback_data: 'ah:home' }],
      [homeButton()],
    ],
  });
}

async function openCabinetLink(admin: SupabaseClient, telegramId: number, chatId: number): Promise<void> {
  const url = await createCabinetLoginUrl(admin, telegramId, '/cabinet/staff');
  await sendAdminMessage(chatId, `🔐 Личный кабинет (staff)\n\n${url}\n\nСсылка одноразовая, ~15 мин.`);
}

async function startGlobalSearch(admin: SupabaseClient, telegramId: number, message: AdminMessage): Promise<void> {
  await saveState(admin, telegramId, message, 'users:search', {});
  await editAdminMessage(
    message,
    '🔎 Поиск человека\n\nОтправь имя, телефон или Telegram ID (мин. 2 символа).',
    {
      inline_keyboard: [
        [{ text: '⬅️ Отмена', callback_data: 'ah:people' }],
        [homeButton()],
      ],
    },
  );
}

export async function handleHubAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  const deliver = editDeliver(message);

  if (data === 'ah:home') {
    await renderAdminHomeDashboard(admin, deliver);
    return true;
  }
  if (data === 'ah:attention') {
    await renderAttentionScreen(admin, deliver);
    return true;
  }
  if (data === 'ah:events') {
    await renderEventsScreen(admin, deliver);
    return true;
  }
  if (data === 'ah:more') {
    await renderMoreMenu(deliver);
    return true;
  }
  if (data === 'ah:people') {
    await renderPeopleMenu(admin, telegramId, deliver);
    return true;
  }
  if (data === 'ah:search') {
    await startGlobalSearch(admin, telegramId, message);
    return true;
  }
  if (data === 'ah:cabinet') {
    await openCabinetLink(admin, telegramId, message.chatId);
    return true;
  }

  if (data === 'ah:go:leads:new') {
    await renderLeadsMenu(admin, deliver);
    return true;
  }
  if (data === 'ah:go:leads:progress') {
    await renderLeadsMenu(admin, deliver, 'in_progress');
    return true;
  }
  if (data === 'ah:go:finance:pending') {
    await renderPurchasesMenu(admin, deliver);
    return true;
  }
  if (data === 'ah:go:finance:packages') {
    await renderPackagesMenu(admin, deliver, 'low');
    return true;
  }
  if (data === 'ah:go:finance:overbook') {
    await renderPackagesMenu(admin, deliver, 'over');
    return true;
  }
  if (data === 'ah:go:moderation') {
    await renderModerationMenu(admin, telegramId, deliver);
    return true;
  }
  if (data === 'ah:go:more:stats') {
    const { renderStatsOverview } = await import('./stats');
    await renderStatsOverview(admin, deliver, '7d');
    return true;
  }
  if (data === 'ah:report:ops') {
    await renderOperationalReport(admin, deliver);
    return true;
  }
  if (isAuditHubAction(data)) {
    return handleAuditHubAction(admin, data, message);
  }
  if (isCommsHubAction(data)) {
    return handleCommsHubAction(admin, data, message, telegramId);
  }
  if (data === 'ah:go:education') {
    await renderEducationMenu(deliver);
    return true;
  }

  if (data === 'ah:stu:menu') {
    await renderStudentsHub(deliver);
    return true;
  }

  const stuFilter = data.match(/^ah:stu:f:([a-z_]+):(\d+)$/);
  if (stuFilter) {
    const filter = stuFilter[1] as StudentFilterId;
    const page = Number(stuFilter[2]) || 0;
    await renderStudentFilterList(admin, message, filter, page);
    return true;
  }

  const stuByTeacher = data.match(/^ah:stu:by:(\d+):(\d+)$/);
  if (stuByTeacher) {
    const teacherId = Number(stuByTeacher[1]);
    const page = Number(stuByTeacher[2]) || 0;
    await renderStudentFilterList(admin, message, 'all', page, teacherId);
    return true;
  }

  const stuPickTeacher = data.match(/^ah:stu:pick:teacher:(\d+)$/);
  if (stuPickTeacher) {
    await renderTeacherPickerForStudents(admin, message, Number(stuPickTeacher[1]) || 0);
    return true;
  }

  const staffProfile = data.match(/^ah:staff:p:(\d+)$/);
  if (staffProfile) {
    const id = Number(staffProfile[1]);
    const staff = await getMemberWithExtras(admin, id);
    if (!staff) {
      await editAdminMessage(message, 'Сотрудник не найден.', {
        inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'ah:staff:0' }], [homeButton()]],
      });
      return true;
    }
    await renderStaffProfile(admin, message, staff);
    return true;
  }

  const staffPage = data.match(/^ah:staff:(\d+)$/);
  if (staffPage) {
    await renderStaffList(admin, message, Number(staffPage[1]) || 0);
    return true;
  }

  return false;
}
