import type { SupabaseClient } from '@supabase/supabase-js';
import { getCourse } from '@/lib/bot/education/courses';
import {
  assignCourseStaffFromAdmin,
  listActiveCourseStaff,
  type CourseStaffRole,
} from '@/lib/bot/education/course-staff';
import { getMember } from '@/lib/bot/roles';
import {
  type AdminMessage,
  type InlineButton,
  editAdminMessage,
  homeButton,
  shorten,
} from './core';
import { memberDisplayName } from './users';
import { listMentorPickerCandidates } from './staff-roster';

const PICKER_PAGE = 8;

async function staffLabel(admin: SupabaseClient, telegramId: number): Promise<string> {
  const member = await getMember(admin, telegramId);
  return member ? memberDisplayName(member) : `ID ${telegramId}`;
}

async function activeStaffLine(
  admin: SupabaseClient,
  courseId: number,
  role: CourseStaffRole,
): Promise<string> {
  const rows = await listActiveCourseStaff(admin, courseId, role);
  const id = rows[0]?.staff_telegram_id;
  if (!id) return 'не назначен';
  return `${await staffLabel(admin, id)} (${id})`;
}

export async function renderCourseStaffMenu(
  admin: SupabaseClient,
  message: AdminMessage,
  courseId: number,
): Promise<void> {
  const course = await getCourse(admin, courseId);
  if (!course) {
    await editAdminMessage(message, 'Курс не найден.', {
      inline_keyboard: [[{ text: '⬅️ Курсы', callback_data: 'ae:courses:0' }], [homeButton()]],
    });
    return;
  }

  const [curatorLine, checkLine] = await Promise.all([
    activeStaffLine(admin, courseId, 'curator'),
    activeStaffLine(admin, courseId, 'check'),
  ]);

  const lines = [
    `👥 Сотрудники курса`,
    `🎓 ${course.title}`,
    '',
    `📡 Куратор (эфиры, материалы):`,
    curatorLine,
    '',
    `📝 Проверяющий ДЗ:`,
    checkLine,
    '',
    'Sanity: districtCourse → curatorTelegramId / checkTelegramId (синхрон при загрузке курса).',
  ];

  const keyboard: InlineButton[][] = [
    [{ text: '📡 Сменить куратора', callback_data: `ae:cs:${courseId}:p:curator:0` }],
    [{ text: '📝 Сменить проверяющего', callback_data: `ae:cs:${courseId}:p:check:0` }],
    [{ text: '⬅️ К карточке курса', callback_data: `ae:course:${courseId}` }],
    [homeButton()],
  ];

  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

async function renderStaffPicker(
  admin: SupabaseClient,
  message: AdminMessage,
  courseId: number,
  role: 'curator' | 'check',
  page: number,
): Promise<void> {
  const course = await getCourse(admin, courseId);
  if (!course) {
    await editAdminMessage(message, 'Курс не найден.', {
      inline_keyboard: [[{ text: '⬅️ Назад', callback_data: `ae:cs:${courseId}:m` }], [homeButton()]],
    });
    return;
  }

  const all =
    role === 'curator'
      ? await listMentorPickerCandidates(admin, 'curator')
      : await listMentorPickerCandidates(admin, 'check');

  const pageCount = Math.max(1, Math.ceil(all.length / PICKER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const slice = all.slice(safePage * PICKER_PAGE, safePage * PICKER_PAGE + PICKER_PAGE);

  const title = role === 'curator' ? 'куратора' : 'проверяющего ДЗ';
  const lines = [
    `Выберите ${title}`,
    `🎓 ${course.title}`,
    '',
    slice.length === 0 ? 'Нет сотрудников с нужной ролью в боте.' : '',
  ].filter(Boolean);

  const keyboard: InlineButton[][] = slice.map((row) => [
    {
      text: shorten(`${row.full_name ?? row.telegram_id} · ${row.rolesLine}`, 58),
      callback_data: `ae:cs:${courseId}:s:${role}:${row.telegram_id}`,
    },
  ]);

  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data: safePage > 0 ? `ae:cs:${courseId}:p:${role}:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data:
          safePage < pageCount - 1 ? `ae:cs:${courseId}:p:${role}:${safePage + 1}` : 'noop',
      },
    ]);
  }

  keyboard.push([{ text: '⬅️ Назад', callback_data: `ae:cs:${courseId}:m` }], [homeButton()]);
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

export function isCourseStaffAdminAction(data: string): boolean {
  return data.startsWith('ae:cs:');
}

export async function handleCourseStaffAdminAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
): Promise<boolean> {
  const menuMatch = data.match(/^ae:cs:(\d+):m$/);
  if (menuMatch) {
    await renderCourseStaffMenu(admin, message, Number(menuMatch[1]));
    return true;
  }

  const pickMatch = data.match(/^ae:cs:(\d+):p:(curator|check):(\d+)$/);
  if (pickMatch) {
    await renderStaffPicker(
      admin,
      message,
      Number(pickMatch[1]),
      pickMatch[2] as 'curator' | 'check',
      Number(pickMatch[3]) || 0,
    );
    return true;
  }

  const setMatch = data.match(/^ae:cs:(\d+):s:(curator|check):(\d+)$/);
  if (setMatch) {
    const courseId = Number(setMatch[1]);
    const role = setMatch[2] as 'curator' | 'check';
    const staffId = Number(setMatch[3]);
    try {
      await assignCourseStaffFromAdmin(admin, courseId, staffId, role);
      const label = await staffLabel(admin, staffId);
      await editAdminMessage(
        message,
        `✅ Назначен ${role === 'curator' ? 'куратор' : 'проверяющий'}:\n${label} (${staffId})`,
        {
          inline_keyboard: [
            [{ text: '👥 Сотрудники курса', callback_data: `ae:cs:${courseId}:m` }],
            [{ text: '⬅️ К курсу', callback_data: `ae:course:${courseId}` }],
            [homeButton()],
          ],
        },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Ошибка назначения';
      await editAdminMessage(message, `❌ ${msg}`, {
        inline_keyboard: [[{ text: '⬅️ Назад', callback_data: `ae:cs:${courseId}:m` }], [homeButton()]],
      });
    }
    return true;
  }

  return false;
}
