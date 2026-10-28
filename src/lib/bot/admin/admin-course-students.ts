import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCuratorCourseStudents } from '@/lib/curator/students';
import { getCourse } from '@/lib/bot/education/courses';
import {
  type AdminMessage,
  type InlineButton,
  editAdminMessage,
  homeButton,
  shorten,
} from './core';
import { adminClientTopicCallback } from './admin-dm-topic';

const PER_PAGE = 8;

export async function renderAdminCourseStudentsList(
  admin: SupabaseClient,
  message: AdminMessage,
  courseId: number,
  page: number,
): Promise<void> {
  const course = await getCourse(admin, courseId);
  if (!course) {
    await editAdminMessage(message, 'Курс не найден.', {
      inline_keyboard: [[{ text: '⬅️ Курсы', callback_data: 'ae:courses:0' }], [homeButton()]],
    });
    return;
  }
  const { students } = await loadCuratorCourseStudents(admin, 0, {
    courseId,
    courseSlug: course.slug,
    skipStaffCheck: true,
    fullPreview: true,
  });
  const pageCount = Math.max(1, Math.ceil(students.length / PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const slice = students.slice(safePage * PER_PAGE, (safePage + 1) * PER_PAGE);

  const lines = [
    `👨‍🎓 Ученики курса`,
    `🎓 ${course.title}`,
    '',
    `Всего: ${students.length}`,
    '',
    ...(slice.length === 0 ? ['Пока никого на курсе.'] : []),
  ];

  const keyboard: InlineButton[][] = slice.map((s) => [
    {
      text: shorten(`${s.name} · ${s.progressPercent}%`, 58),
      callback_data: `ae:cr:${courseId}:s:${s.telegramId}:${safePage}`,
    },
  ]);
  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️' : '·',
        callback_data: safePage > 0 ? `ae:cr:${courseId}:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data: safePage < pageCount - 1 ? `ae:cr:${courseId}:${safePage + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push(
    [{ text: '⬅️ К курсу', callback_data: `ae:course:${courseId}` }],
    [{ text: '⬅️ Обучение', callback_data: 'ae:menu' }],
    [homeButton()],
  );
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

export async function renderAdminCourseStudentCard(
  admin: SupabaseClient,
  message: AdminMessage,
  courseId: number,
  studentTelegramId: number,
  listPage: number,
): Promise<void> {
  const course = await getCourse(admin, courseId);
  if (!course) {
    await editAdminMessage(message, 'Курс не найден.', {
      inline_keyboard: [[{ text: '⬅️ Курсы', callback_data: 'ae:courses:0' }], [homeButton()]],
    });
    return;
  }
  const { students } = await loadCuratorCourseStudents(admin, 0, {
    courseId,
    courseSlug: course.slug,
    skipStaffCheck: true,
    fullPreview: true,
  });
  const student = students.find((s) => s.telegramId === studentTelegramId);
  if (!student) {
    await editAdminMessage(message, 'Ученик не найден на этом курсе.', {
      inline_keyboard: [[{ text: '⬅️ К списку', callback_data: `ae:cr:${courseId}:${listPage}` }], [homeButton()]],
    });
    return;
  }

  const hw = student.homeworks ?? [];
  const submitted = hw.filter((h) => h.status === 'submitted').length;
  const approved = hw.filter((h) => h.status === 'approved').length;
  const revision = hw.filter((h) => h.status === 'revision').length;
  const waiting = hw.filter((h) => h.status === 'waiting').length;
  const accessLine = student.fullyBlocked
    ? '🔒 Полная блокировка'
    : student.accessBlocked
      ? '⏸️ Заморожен (0 жизней)'
      : '✅ Активный доступ';

  const lines = [
    `👨‍🎓 ${student.name}`,
    `🎓 ${course.title}`,
    '',
    accessLine,
    `📊 Прогресс: ${student.progressPercent}% (${student.completedLessons}/${student.totalLessons})`,
    `❤️ Жизни: ${student.livesCurrent ?? '—'}${student.livesMax != null ? `/${student.livesMax}` : ''}`,
    '',
    '📝 Домашние задания:',
    `• На проверке: ${submitted}`,
    `• Одобрено: ${approved}`,
    `• На доработке: ${revision}`,
    `• Не сдано: ${waiting}`,
    `• Просрочено: ${student.overdueHomeworkCount}`,
  ];

  const keyboard: InlineButton[][] = [
    [{ text: '💬 Связаться', callback_data: adminClientTopicCallback(studentTelegramId) }],
    [{ text: '❤️ Жизни и блокировка', callback_data: `al:m:${studentTelegramId}` }],
    [{ text: '👤 Профиль в «Люди»', callback_data: `admin:user:${studentTelegramId}::` }],
    [{ text: '⬅️ К списку учеников', callback_data: `ae:cr:${courseId}:${listPage}` }],
    [{ text: '⬅️ К курсу', callback_data: `ae:course:${courseId}` }],
    [homeButton()],
  ];
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}
