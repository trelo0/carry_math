import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type AdminMessage,
  type InlineButton,
  USERS_PER_PAGE,
  editAdminMessage,
  homeButton,
  shorten,
} from './core';
import { memberDisplayName } from './users';
import {
  formatExtraRolesList,
  listStaffMembersFiltered,
  loadStaffStats,
  memberRolesSummary,
  type StaffMemberRow,
  type StaffRoleFilter,
} from './staff-roster';

const FILTER_BUTTONS: Array<{ id: StaffRoleFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'teacher', label: 'Преподаватели' },
  { id: 'curator', label: 'Кураторы' },
  { id: 'admin', label: 'Админы' },
];

function filterFromCallback(part: string | undefined): StaffRoleFilter {
  if (part === 'teacher' || part === 'curator' || part === 'admin') return part;
  return 'all';
}

function staffLineSummary(stats: Awaited<ReturnType<typeof loadStaffStats>>): string {
  const students = stats.studentsAsTeacher + stats.studentsAsCurator;
  const groups = stats.groupsTeacher + stats.groupsCurator;
  const parts: string[] = [];
  if (students > 0) parts.push(`${students} учен.`);
  if (groups > 0) parts.push(`${groups} групп`);
  return parts.length ? parts.join(' · ') : '—';
}

export async function renderStaffList(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
  roleFilter: StaffRoleFilter = 'all',
): Promise<void> {
  const { members, total } = await listStaffMembersFiltered(admin, roleFilter, page, USERS_PER_PAGE);
  const pageCount = Math.max(1, Math.ceil(total / USERS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);

  const lines = ['👨‍💼 Сотрудники', ''];
  const statsList = await Promise.all(members.map((m) => loadStaffStats(admin, m.telegram_id)));

  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const roles = memberRolesSummary(m.role, m.extra_roles ?? []);
    lines.push(`${memberDisplayName(m)}`, roles, staffLineSummary(statsList[i]), '');
  }
  if (members.length === 0) lines.push('Сотрудников не найдено.');

  const filterRow = FILTER_BUTTONS.map((f) => ({
    text: f.id === roleFilter ? `[${f.label}]` : f.label,
    callback_data: `ah:staff:f:${f.id}:0`,
  }));

  const keyboard: InlineButton[][] = [filterRow];
  for (const m of members) {
    keyboard.push([
      {
        text: shorten(`${memberDisplayName(m)} · ${memberRolesSummary(m.role, m.extra_roles ?? [])}`, 58),
        callback_data: `ah:staff:p:${m.telegram_id}:${roleFilter}:${safePage}`,
      },
    ]);
  }

  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data: safePage > 0 ? `ah:staff:f:${roleFilter}:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data: safePage < pageCount - 1 ? `ah:staff:f:${roleFilter}:${safePage + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push([{ text: '⬅️ Люди', callback_data: 'ah:people' }], [homeButton()]);

  await editAdminMessage(message, lines.join('\n').slice(0, 3900), { inline_keyboard: keyboard });
}

export async function renderStaffProfile(
  admin: SupabaseClient,
  message: AdminMessage,
  staff: StaffMemberRow,
  listFilter: StaffRoleFilter = 'all',
  listPage = 0,
): Promise<void> {
  const stats = await loadStaffStats(admin, staff.telegram_id);
  const roles = memberRolesSummary(staff.role, staff.extra_roles ?? []);
  const lines = [
    `👨‍💼 ${memberDisplayName(staff)}`,
    '',
    roles,
    staff.phone ? `📱 ${staff.phone}` : '',
    staff.chat_id ? '💬 Telegram подключён' : '💬 Telegram не подключён',
    '',
    `👨‍🎓 Ученики — ${stats.studentsAsTeacher + stats.studentsAsCurator}`,
    `👥 Группы — ${stats.groupsTeacher + stats.groupsCurator}`,
    stats.studentsAsTeacher > 0 ? `   (как препод: ${stats.studentsAsTeacher})` : '',
    stats.studentsAsCurator > 0 ? `   (как куратор: ${stats.studentsAsCurator})` : '',
  ].filter(Boolean);

  const id = staff.telegram_id;
  const backCb = `ah:staff:f:${listFilter}:${listPage}`;
  const keyboard: InlineButton[][] = [
    [{ text: '👨‍🎓 Ученики', callback_data: `ah:stu:by:${id}:0` }],
    [{ text: '📅 Расписание', callback_data: `ae:ls:w:0:${id}` }],
    [
      { text: '✏️ Изменить', callback_data: `admin:user:${id}::staff:${listFilter}:${listPage}` },
    ],
    [{ text: '⬅️ Назад', callback_data: backCb }],
    [homeButton()],
  ];
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

export function parseStaffListCallback(data: string): { filter: StaffRoleFilter; page: number } | null {
  const m = data.match(/^ah:staff:f:(all|teacher|curator|admin):(\d+)$/);
  if (!m) return null;
  return { filter: filterFromCallback(m[1]), page: Number(m[2]) || 0 };
}

export function parseStaffProfileCallback(
  data: string,
): { id: number; filter: StaffRoleFilter; page: number } | null {
  const m = data.match(/^ah:staff:p:(\d+):(all|teacher|curator|admin):(\d+)$/);
  if (!m) return null;
  return { id: Number(m[1]), filter: filterFromCallback(m[2]), page: Number(m[3]) || 0 };
}
