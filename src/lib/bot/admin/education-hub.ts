import type { SupabaseClient } from '@supabase/supabase-js';
import { getStudentTeacher } from '@/lib/bot/education/assignments';
import { getActiveCourses, getCourse, type Course } from '@/lib/bot/education/courses';
import { ACCESS_PRODUCT_LABELS } from '../accesses';
import {
  type AdminMessage,
  type Deliver,
  type InlineButton,
  editAdminMessage,
  homeButton,
  shorten,
} from './core';
import { memberDisplayName } from './users';
import { getMember } from '@/lib/bot/roles';

const COURSES_PER_PAGE = 6;
const INDIVIDUAL_PER_PAGE = 8;

export async function renderEducationMenu(deliver: Deliver): Promise<void> {
  await deliver(
    '📚 Обучение\n\nКурсы, группы, индивидуальное и расписание школы.',
    {
      inline_keyboard: [
        [{ text: '🎓 Курсы', callback_data: 'ae:courses:0' }],
        [{ text: '👥 Группы', callback_data: 'ae:groups:0' }],
        [{ text: '👤 Индивидуальные', callback_data: 'ae:ind:0' }],
        [{ text: '📝 Домашние задания', callback_data: 'ae:hw:hub' }],
        [{ text: '📅 Расписание', callback_data: 'ae:ls:day:0:a:0:0' }],
        [homeButton()],
      ],
    },
  );
}

async function countCourseStudents(admin: SupabaseClient, courseId: number): Promise<number> {
  const { count, error } = await admin
    .from('course_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('course_id', courseId)
    .eq('status', 'active');
  if (error) return 0;
  return count ?? 0;
}

function courseStatusLine(course: Course): string {
  return course.is_active ? '🟢 Активен' : '⏸️ Не активен';
}

export async function renderCoursesList(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  const courses = await getActiveCourses(admin);
  let inactiveRows: Course[] = [];
  try {
    const inactive = await admin
      .from('courses')
      .select('id, title, slug, description, is_active, created_at, updated_at')
      .eq('is_active', false)
      .order('created_at', { ascending: true });
    inactiveRows = (inactive.data ?? []) as Course[];
  } catch {
    inactiveRows = [];
  }
  const all = [...courses, ...inactiveRows];
  const pageCount = Math.max(1, Math.ceil(all.length / COURSES_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const slice = all.slice(safePage * COURSES_PER_PAGE, safePage * COURSES_PER_PAGE + COURSES_PER_PAGE);

  const lines = ['🎓 Курсы', '', 'Структура модулей и уроков — в кабинете на сайте.', ''];
  for (const c of slice) {
    const n = await countCourseStudents(admin, c.id);
    lines.push(`🎓 ${c.title}`, `👨‍🎓 Учеников: ${n}`, courseStatusLine(c), '');
  }
  if (slice.length === 0) lines.push('Курсов пока нет.');

  const keyboard: InlineButton[][] = slice.map((c) => [
    { text: shorten(c.title, 40), callback_data: `ae:course:${c.id}` },
  ]);
  if (pageCount > 1) {
    keyboard.push([
      { text: safePage > 0 ? '⬅️' : '·', callback_data: safePage > 0 ? `ae:courses:${safePage - 1}` : 'noop' },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data: safePage < pageCount - 1 ? `ae:courses:${safePage + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push([{ text: '⬅️ Обучение', callback_data: 'ae:menu' }], [homeButton()]);
  await editAdminMessage(message, lines.join('\n').slice(0, 3900), { inline_keyboard: keyboard });
}

export async function renderCourseDetail(
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
  const students = await countCourseStudents(admin, courseId);
  const lines = [
    `🎓 ${course.title}`,
    '',
    `👨‍🎓 Учеников: ${students}`,
    course.description ? `📄 ${shorten(course.description, 200)}` : '',
    courseStatusLine(course),
    '',
    'Модули, уроки, ДЗ и прогресс — на сайте в кабинете staff.',
  ].filter(Boolean);

  const keyboard: InlineButton[][] = [
    [{ text: '👨‍🎓 Ученики курса', callback_data: `ae:ls:course:0` }],
    [{ text: '⬅️ К списку курсов', callback_data: 'ae:courses:0' }],
    [homeButton()],
  ];
  await editAdminMessage(message, lines.join('\n'), { inline_keyboard: keyboard });
}

type IndividualRow = { telegram_id: number; name: string; teacher: string; active: boolean };

async function loadIndividualRows(admin: SupabaseClient): Promise<IndividualRow[]> {
  const { data, error } = await admin
    .from('user_accesses')
    .select('telegram_id')
    .eq('product', 'individual')
    .eq('status', 'active');
  if (error) throw error;
  const ids = [...new Set((data ?? []).map((r) => r.telegram_id as number))];
  const rows: IndividualRow[] = [];
  for (const id of ids) {
    const member = await getMember(admin, id);
    const teacher = await getStudentTeacher(admin, id);
    rows.push({
      telegram_id: id,
      name: member ? memberDisplayName(member) : `ID ${id}`,
      teacher: teacher?.fullName ?? (teacher ? `ID ${teacher.telegramId}` : 'не назначен'),
      active: true,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return rows;
}

export async function renderIndividualList(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  const all = await loadIndividualRows(admin);
  const pageCount = Math.max(1, Math.ceil(all.length / INDIVIDUAL_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const slice = all.slice(safePage * INDIVIDUAL_PER_PAGE, safePage * INDIVIDUAL_PER_PAGE + INDIVIDUAL_PER_PAGE);

  const lines = ['👤 Индивидуальное обучение', ''];
  for (const row of slice) {
    lines.push(
      `👤 ${row.name}`,
      `${ACCESS_PRODUCT_LABELS.individual}`,
      `👨‍🏫 ${row.teacher}`,
      row.active ? '🟢 Активен' : '⏸️ Пауза',
      '',
    );
  }
  if (slice.length === 0) lines.push('Нет учеников с активным индивидуальным доступом.');

  const keyboard: InlineButton[][] = slice.map((row) => [
    {
      text: shorten(`${row.name} · ${row.teacher}`, 58),
      callback_data: `admin:user:${row.telegram_id}::edu:ind:${safePage}`,
    },
  ]);
  if (pageCount > 1) {
    keyboard.push([
      { text: safePage > 0 ? '⬅️' : '·', callback_data: safePage > 0 ? `ae:ind:${safePage - 1}` : 'noop' },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️' : '·',
        callback_data: safePage < pageCount - 1 ? `ae:ind:${safePage + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push([{ text: '⬅️ Обучение', callback_data: 'ae:menu' }], [homeButton()]);
  await editAdminMessage(message, lines.join('\n').slice(0, 3900), { inline_keyboard: keyboard });
}

export function handleEducationHubAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
): Promise<boolean> | boolean {
  if (data === 'ae:menu') {
    return false;
  }
  if (data.startsWith('ae:courses:')) {
    const page = Number(data.slice('ae:courses:'.length)) || 0;
    return renderCoursesList(admin, message, page).then(() => true);
  }
  const courseMatch = data.match(/^ae:course:(\d+)$/);
  if (courseMatch) {
    return renderCourseDetail(admin, message, Number(courseMatch[1])).then(() => true);
  }
  if (data.startsWith('ae:ind:')) {
    const page = Number(data.slice('ae:ind:'.length)) || 0;
    return renderIndividualList(admin, message, page).then(() => true);
  }
  return false;
}
