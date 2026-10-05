import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type AdminMessage,
  USERS_PER_PAGE,
  editAdminMessage,
  editDeliver,
  homeButton,
  shorten,
  type Deliver,
  type InlineButton,
} from './core';
import { memberDisplayName } from './users';
import {
  formatExtraRolesList,
  listStaffMembers,
  loadStaffStats,
  memberRolesSummary,
  type StaffMemberRow,
} from './staff-roster';

export async function renderStaffList(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  const { members, total } = await listStaffMembers(admin, page, USERS_PER_PAGE);
  const pageCount = Math.max(1, Math.ceil(total / USERS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);

  const lines = [
    '👨‍💼 Сотрудники',
    '',
    ...members.map(
      (m, i) =>
        `${safePage * USERS_PER_PAGE + i + 1}. ${memberDisplayName(m)}\n   🎭 ${memberRolesSummary(m.role, m.extra_roles ?? [])}`,
    ),
  ];
  if (members.length === 0) lines.push('Сотрудников не найдено.');

  const keyboard: InlineButton[][] = members.map((m) => [
    {
      text: shorten(`${memberDisplayName(m)} · ${memberRolesSummary(m.role, m.extra_roles ?? [])}`, 58),
      callback_data: `ah:staff:p:${m.telegram_id}`,
    },
  ]);

  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data: safePage > 0 ? `ah:staff:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data: safePage < pageCount - 1 ? `ah:staff:${safePage + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push([{ text: '⬅️ Люди', callback_data: 'ah:people' }], [homeButton()]);

  await editAdminMessage(message, lines.join('\n\n'), { inline_keyboard: keyboard });
}

export async function renderStaffProfile(
  admin: SupabaseClient,
  message: AdminMessage,
  staff: StaffMemberRow,
): Promise<void> {
  const stats = await loadStaffStats(admin, staff.telegram_id);
  const lines = [
    `👨‍💼 ${memberDisplayName(staff)}`,
    staff.phone ? `📱 ${staff.phone}` : '',
    `✈️ Telegram: ${staff.chat_id ? 'подключён' : 'не подключён'}`,
    `🎭 Основная: ${memberRolesSummary(staff.role, [])}`,
    `➕ Доп. роли: ${formatExtraRolesList(staff.extra_roles ?? [])}`,
    '',
    `👨‍🎓 Учеников (препод): ${stats.studentsAsTeacher}`,
    `👨‍🎓 Закреплено (куратор): ${stats.studentsAsCurator}`,
    `👥 Групп (препод): ${stats.groupsTeacher}`,
    `👥 Групп (куратор): ${stats.groupsCurator}`,
  ].filter(Boolean);

  const id = staff.telegram_id;
  const keyboard: InlineButton[][] = [
    [{ text: '👤 Полная карточка', callback_data: `admin:user:${id}::` }],
    [{ text: '➕ Доп. роли', callback_data: `admin:user:${id}:extra::` }],
    [{ text: '⬅️ К списку', callback_data: 'ah:staff:0' }],
    [homeButton()],
  ];
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

export async function openStaffListDeliver(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const { members, total } = await listStaffMembers(admin, 0, USERS_PER_PAGE);
  void total;
  const lines = ['👨‍💼 Сотрудники', ''];
  for (const m of members) {
    lines.push(`• ${memberDisplayName(m)} — ${memberRolesSummary(m.role, m.extra_roles ?? [])}`);
  }
  const keyboard: InlineButton[][] = members.slice(0, 8).map((m) => [
    { text: memberDisplayName(m), callback_data: `ah:staff:p:${m.telegram_id}` },
  ]);
  keyboard.push([{ text: '📋 Полный список', callback_data: 'ah:staff:0' }], [homeButton()]);
  await deliver(lines.join('\n'), { inline_keyboard: keyboard });
}
