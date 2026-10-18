import type { SupabaseClient } from '@supabase/supabase-js';
import type { InlineKeyboard } from '@/lib/bot/admin/core';
import { listStaffCourseAssignmentOptions } from '@/lib/curator/course-context';
import {
  courseRoleBadge,
  filterStaffCourseRows,
  STAFF_COURSE_LIST_INTRO,
  STAFF_COURSE_LIST_TITLE,
  groupStaffCourseRows,
  staffCourseRowsFromOptions,
  type StaffCourseAssignmentRow,
  type StaffCourseListFilter,
} from '@/lib/staff/course-assignment-ui';
import { CURATOR_NO_COURSES_TEXT } from './curator-bot-access';

export type { StaffCourseAssignmentRow };

function back(text: string, data: string) {
  return { text, callback_data: data };
}

export async function loadStaffMyCourseRows(
  admin: SupabaseClient,
  telegramId: number,
): Promise<StaffCourseAssignmentRow[]> {
  const options = await listStaffCourseAssignmentOptions(admin, telegramId);
  return staffCourseRowsFromOptions(options);
}

export function renderMyCourseListScreen(
  rows: StaffCourseAssignmentRow[],
  options?: { backCallback?: string; backLabel?: string },
): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const backCb = options?.backCallback ?? 's:menu';
  const backLabel = options?.backLabel ?? '⬅️ Главное меню';

  if (rows.length === 0) {
    return {
      text: CURATOR_NO_COURSES_TEXT,
      keyboard: { inline_keyboard: [[back('⬅️ Закрыть', backCb)]] },
    };
  }

  const lines = [STAFF_COURSE_LIST_TITLE, '', STAFF_COURSE_LIST_INTRO, ''];

  const keyboard: InlineKeyboard['inline_keyboard'] = [];
  for (const group of groupStaffCourseRows(rows)) {
    if (group.roles.length === 1) {
      const role = group.roles[0]!;
      keyboard.push([
        back(`${group.title} · ${courseRoleBadge(role)}`, `c:mc:${group.courseId}:${role}`),
      ]);
      continue;
    }
    keyboard.push([
      { text: `📡 ${group.title} · вебинары`, callback_data: `c:mc:${group.courseId}:curator` },
      { text: '📝 ДЗ', callback_data: `c:mc:${group.courseId}:check` },
    ]);
  }
  keyboard.push([back(backLabel, backCb)]);

  return { text: lines.join('\n'), keyboard: { inline_keyboard: keyboard } };
}

export function renderMyCourseListForFilter(
  rows: StaffCourseAssignmentRow[],
  filter: StaffCourseListFilter,
): ReturnType<typeof renderMyCourseListScreen> {
  return renderMyCourseListScreen(filterStaffCourseRows(rows, filter));
}

export function renderMyCourseRoleMenu(
  courseTitle: string,
  courseId: number,
  role: 'curator' | 'check',
): { text: string; keyboard: InlineKeyboard } {
  if (role === 'curator') {
    return {
      text: [`🎓 ${courseTitle}`, '', 'Вы — куратор этого курса.', ''].join('\n'),
      keyboard: {
        inline_keyboard: [
          [back('📅 Расписание курса', `c:cal:${courseId}`)],
          [back('📚 Занятия курса', `c:les:${courseId}`)],
          [back('👥 Ученики курса', `c:stu:${courseId}`)],
          [back('⬅️ Мои курсы', 'c:mc')],
        ],
      },
    };
  }

  return {
    text: [
      `🎓 ${courseTitle}`,
      '',
      'Вы — проверяющий домашних заданий.',
      'Проверка ДЗ по этому курсу — в Telegram (раздел в разработке).',
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [{ text: '📝 Домашние задания (скоро)', callback_data: 'noop' }],
        [back('⬅️ Мои курсы', 'c:mc')],
      ],
    },
  };
}
