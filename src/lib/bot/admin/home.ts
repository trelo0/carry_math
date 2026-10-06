import type { SupabaseClient } from '@supabase/supabase-js';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import { getMember } from '@/lib/bot/roles';
import {
  type AdminMessage,
  type Deliver,
  type InlineButton,
  ADMIN_HOME_TEXT,
  editAdminMessage,
  editDeliver,
  homeButton,
  saveState,
  sendAdminMessage,
  shorten,
} from './core';
import {
  fetchAdminHubMetrics,
  fetchTodayLessonsPreview,
  type AdminHubMetrics,
  type TodayLessonRow,
} from './hub-metrics';
import { renderMoreMenu } from './more-menu';
import { renderBotCopyMenu } from './bot-copy-menu';
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
import { adminActionLabel, listAdminActionLog, type AdminActionLogRow } from './action-log';
import { handleScheduleListAction } from './schedule-ops';
import { memberDisplayName } from './users';

export function isHubAction(data: string): boolean {
  return data.startsWith('ah:');
}

function formatEventFeedLine(row: AdminActionLogRow): string {
  const time = new Date(row.created_at).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  });
  const label = adminActionLabel(row.action);
  const tail = row.entity_id ? ` #${row.entity_id}` : '';
  return `${time} — ${label}${tail}`;
}

async function formatTodayLessonLine(admin: SupabaseClient, row: TodayLessonRow): Promise<string> {
  const time = new Date(row.starts_at).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  });
  const member = await getMember(admin, row.telegram_id);
  const name = member ? memberDisplayName(member) : `#${row.telegram_id}`;
  const kind =
    row.kind === 'trial'
      ? 'пробное'
      : row.kind === 'group'
        ? 'группа'
        : row.kind === 'individual'
          ? 'индивидуальное'
          : row.topic || row.kind;
  const topic = row.topic && row.kind !== 'trial' ? ` «${shorten(row.topic, 24)}»` : '';
  return `• ${time} — ${kind}${topic} → ${shorten(name, 28)}`;
}

export async function buildAdminHomeDashboardText(
  admin: SupabaseClient,
  metrics: AdminHubMetrics,
  testFooter = '',
): Promise<string> {
  const attentionItems = buildAttentionItems(metrics);
  const { rows: logRows } = await listAdminActionLog(admin, 0, 6);
  const { dateLabel, rows: todayRows } = await fetchTodayLessonsPreview(admin, 5);
  const todayLines = await Promise.all(todayRows.map((r) => formatTodayLessonLine(admin, r)));

  const attentionLines =
    attentionItems.length === 0
      ? ['Сейчас нет срочных задач по счётчикам.']
      : attentionItems.map((item) => `• ${item.text}`);

  const eventLines =
    logRows.length > 0
      ? logRows.map((r) => formatEventFeedLine(r))
      : ['Пока нет записей в журнале действий.'];

  const todayBlock =
    todayLines.length > 0
      ? todayLines
      : metrics.lessonsToday > 0
        ? ['Занятия есть — открой расписание.']
        : ['На сегодня запланированных занятий нет.'];

  return [
    ADMIN_HOME_TEXT.trim() + testFooter,
    '',
    '⚡ Требует внимания',
    '',
    ...attentionLines,
    '',
    '🔔 Последние события',
    '',
    ...eventLines,
    '',
    '📅 Сегодня',
    '',
    `Сегодня, ${dateLabel}`,
    '',
    ...todayBlock,
    '',
    '📊 Состояние школы',
    '',
    'Ученики',
    `• ${metrics.studentsActive} активных`,
    `• ${metrics.studentsPaused} на паузе`,
    `• ${metrics.studentsNew} новых`,
    '',
    'Заявки',
    `• ${metrics.leadsNew} новых`,
    `• ${metrics.leadsInProgress} в работе`,
    '',
    'Финансы',
    `• ${metrics.purchasesPending} ожидают оплаты`,
    `• ${metrics.packagesLow} пакета заканчиваются`,
    '',
    'Занятия',
    `• ${metrics.lessonsToday} сегодня`,
    metrics.scheduleProblems > 0
      ? `• ${metrics.scheduleProblems} проблема расписания`
      : '• проблем расписания нет',
  ].join('\n');
}

function buildAdminHomeInlineKeyboard(metrics: AdminHubMetrics): InlineButton[][] {
  const rows: InlineButton[][] = [];
  for (const item of buildAttentionItems(metrics)) {
    rows.push([{ text: item.text, callback_data: item.callback }]);
  }
  if (rows.length === 0) {
    rows.push([{ text: '✅ Срочных задач нет', callback_data: 'ah:home' }]);
  }
  rows.push([{ text: '📜 Журнал событий', callback_data: 'ah:audit:0' }]);
  rows.push([{ text: '📅 Открыть расписание', callback_data: 'ah:go:schedule' }]);

  rows.push([
    { text: `👨‍🎓 ${metrics.studentsActive} активных`, callback_data: 'ah:stu:f:active:0' },
    { text: `📨 ${metrics.leadsNew} заявок`, callback_data: 'ah:go:leads:new' },
  ]);
  rows.push([
    { text: `💳 ${metrics.purchasesPending} оплат`, callback_data: 'ah:go:finance:pending' },
    { text: `📅 ${metrics.lessonsToday} сегодня`, callback_data: 'ah:go:schedule' },
  ]);
  return rows;
}

export async function renderAdminHomeDashboard(
  admin: SupabaseClient,
  deliver: Deliver,
  testFooter = '',
): Promise<void> {
  const metrics = await fetchAdminHubMetrics(admin);
  const text = await buildAdminHomeDashboardText(admin, metrics, testFooter);
  await deliver(text, { inline_keyboard: buildAdminHomeInlineKeyboard(metrics) });
}

async function renderAttentionScreen(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const metrics = await fetchAdminHubMetrics(admin);
  const items = buildAttentionItems(metrics);
  const text =
    items.length === 0
      ? '⚡ Требует внимания\n\nСейчас нет пунктов по автоматическим счётчикам.'
      : ['⚡ Требует внимания', '', 'Нажми пункт — откроется список для работы.', ''].join('\n');
  const keyboard: InlineButton[][] = items.map((item) => [{ text: item.text, callback_data: item.callback }]);
  keyboard.push(
    [{ text: '🚩 Все проблемы', callback_data: 'ah:problems' }],
    [{ text: '⬅️ На главную', callback_data: 'ah:home' }],
    [homeButton()],
  );
  await deliver(text, { inline_keyboard: keyboard });
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
  if (data === 'ah:more') {
    await renderMoreMenu(deliver);
    return true;
  }
  if (data === 'ah:botcopy') {
    await renderBotCopyMenu(deliver);
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
    const url = await createCabinetLoginUrl(admin, telegramId, '/cabinet/staff');
    await sendAdminMessage(message.chatId, `🔐 Личный кабинет (staff)\n\n${url}\n\nСсылка одноразовая, ~15 мин.`);
    return true;
  }
  if (data === 'ah:go:schedule') {
    return handleScheduleListAction(admin, 'ae:ls:w:0:0', message, telegramId);
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
