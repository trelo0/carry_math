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
import { fetchAdminHubMetrics } from './hub-metrics';
import { renderMoreMenu } from './more-menu';
import { renderBotCopyMenu } from './bot-copy-menu';
import { renderPeopleMenu } from './people-menu';
import { renderLeadsMenu } from './leads';
import { renderPurchasesMenu } from './purchases';
import { renderPackagesMenu } from './packages-menu';
import { renderEducationMenu } from './education-ops';
import { renderModerationMenu } from './moderation';
import {
  parseStaffListCallback,
  parseStaffProfileCallback,
  renderStaffList,
  renderStaffProfile,
} from './staff-catalog';
import { getMemberWithExtras } from './staff-roster';
import {
  renderStudentsHub,
  renderStudentFilterList,
  renderTeacherPickerForStudents,
  type StudentFilterId,
} from './student-catalog';
import { handleCommsHubAction, isCommsHubAction } from './comms-ops';
import { buildAttentionItems } from './home-attention';
import { buildAdminHomeDashboard } from './home-dashboard';
import { handleAuditHubAction, isAuditHubAction } from './audit-menu';
import { handleProblemsAction, isProblemsAction } from './problems-menu';
import { renderOperationalReport } from './reports-ops';
import { handleScheduleListAction } from './schedule-ops';
import { renderProblemsControlHub } from './more-problems-control';
import {
  parseSchoolReportCallback,
  parseSchoolReportSectionCallback,
  renderSchoolReportSection,
  renderSchoolReports,
} from './school-reports';

export function isHubAction(data: string): boolean {
  return data.startsWith('ah:');
}

export async function renderAdminHomeDashboard(
  admin: SupabaseClient,
  deliver: Deliver,
  telegramId: number,
  testFooter = '',
): Promise<void> {
  const { text, keyboard } = await buildAdminHomeDashboard(admin, telegramId, testFooter);
  const markup =
    keyboard && keyboard.length > 0 ? { inline_keyboard: keyboard } : { inline_keyboard: [] };
  await deliver(text, markup);
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

async function startPeopleSearch(admin: SupabaseClient, telegramId: number, message: AdminMessage): Promise<void> {
  await saveState(admin, telegramId, message, 'users:search', { searchBack: 'ah:people' });
  await editAdminMessage(
    message,
    '🔎 Поиск человека\n\nИмя, фамилия, телефон, Telegram ID или @username.\nМинимум 2 символа.',
    {
      inline_keyboard: [
        [{ text: '⬅️ Назад', callback_data: 'ah:people' }],
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
    await renderAdminHomeDashboard(admin, deliver, telegramId);
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
  if (data === 'ah:more:problems-control') {
    await renderProblemsControlHub(admin, deliver);
    return true;
  }
  if (data === 'ah:more:reports') {
    await renderSchoolReports(admin, deliver, 'today');
    return true;
  }
  const schoolRep = parseSchoolReportCallback(data);
  if (schoolRep) {
    await renderSchoolReports(admin, deliver, schoolRep);
    return true;
  }
  const schoolSec = parseSchoolReportSectionCallback(data);
  if (schoolSec) {
    await renderSchoolReportSection(admin, deliver, schoolSec.section, schoolSec.period);
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
  if (data === 'ah:people:search' || data === 'ah:search') {
    await startPeopleSearch(admin, telegramId, message);
    return true;
  }
  if (data === 'ah:cabinet') {
    const url = await createCabinetLoginUrl(admin, telegramId, '/cabinet/staff');
    await sendAdminMessage(message.chatId, `🔐 Личный кабинет (staff)\n\n${url}\n\nСсылка одноразовая, ~15 мин.`);
    return true;
  }
  if (data === 'ah:go:schedule') {
    return handleScheduleListAction(admin, 'ae:ls:day:0:a:0:0', message, telegramId);
  }

  if (data === 'ah:go:leads:new') {
    await renderLeadsMenu(admin, deliver, 'new');
    return true;
  }
  if (data === 'ah:go:leads:progress') {
    await renderLeadsMenu(admin, deliver, 'in_work');
    return true;
  }
  if (data === 'ah:go:finance:pending') {
    const { renderFinanceDueList } = await import('./finance-ops');
    await renderFinanceDueList(admin, deliver, 0);
    return true;
  }
  if (data === 'ah:go:finance:packages') {
    const { renderPackagesHub } = await import('./packages-menu');
    await renderPackagesHub(admin, deliver);
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
  if (isProblemsAction(data)) {
    return handleProblemsAction(admin, data, message, telegramId);
  }
  if (isAuditHubAction(data)) {
    return handleAuditHubAction(admin, data, message, telegramId);
  }
  if (isCommsHubAction(data)) {
    return handleCommsHubAction(admin, data, message, telegramId);
  }
  if (data === 'ah:go:education') {
    await renderEducationMenu(deliver);
    return true;
  }

  if (data === 'ah:stu:menu') {
    await renderStudentsHub(admin, deliver);
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

  const staffProfileParsed = parseStaffProfileCallback(data);
  if (staffProfileParsed) {
    const staff = await getMemberWithExtras(admin, staffProfileParsed.id);
    if (!staff) {
      await editAdminMessage(message, 'Сотрудник не найден.', {
        inline_keyboard: [
          [{ text: '⬅️ Назад', callback_data: `ah:staff:f:${staffProfileParsed.filter}:${staffProfileParsed.page}` }],
          [homeButton()],
        ],
      });
      return true;
    }
    await renderStaffProfile(admin, message, staff, staffProfileParsed.filter, staffProfileParsed.page);
    return true;
  }

  const staffListParsed = parseStaffListCallback(data);
  if (staffListParsed) {
    await renderStaffList(admin, message, staffListParsed.page, staffListParsed.filter);
    return true;
  }

  const staffPageLegacy = data.match(/^ah:staff:(\d+)$/);
  if (staffPageLegacy) {
    await renderStaffList(admin, message, Number(staffPageLegacy[1]) || 0, 'all');
    return true;
  }

  if (data === 'ah:stu:adv') {
    const { renderStudentsAdvancedFilters } = await import('./student-catalog');
    await renderStudentsAdvancedFilters(admin, message);
    return true;
  }

  return false;
}
