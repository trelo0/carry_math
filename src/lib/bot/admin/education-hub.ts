import type { SupabaseClient } from '@supabase/supabase-js';
import { getStudentTeacher } from '@/lib/bot/education/assignments';
import { getActiveCourses, getCourse, type Course } from '@/lib/bot/education/courses';
import { listActiveCourseStaff } from '@/lib/bot/education/course-staff';
import { listCoursesPresentInSanity } from '@/lib/bot/education/course-record';
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
import { handleLivesHubAction, isLivesHubAction } from './lives-hub';

const COURSES_PER_PAGE = 6;
const INDIVIDUAL_PER_PAGE = 8;

export async function renderEducationMenu(deliver: Deliver): Promise<void> {
  await deliver(
    '📚 Обучение\n\nКурсы, группы, индивидуальное и расписание школы.',
    {
      inline_keyboard: [
        [{ text: '🎓 Курсы', callback_data: 'ae:courses:0' }],
        [{ text: '❤️ Жизни', callback_data: 'ae:lives' }],
        [{ text: '👥 Группы', callback_data: 'ae:groups:0' }],
        [{ text: '👤 Индивидуальные', callback_data: 'ae:ind:0' }],
        [{ text: '📝 Домашние задания', callback_data: 'ae:hw:hub' }],
        [{ text: '📅 Расписание', callback_data: 'ae:ls:day:0:a:0:0' }],
        [{ text: '🔄 Миграция staff', callback_data: 'ae:migrate:staff' }],
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
  // Только курсы из актуального Sanity — без «призраков» из Supabase.
  let all: Course[] = [];
  try {
    all = (await listCoursesPresentInSanity(admin)) as Course[];
  } catch (error) {
    console.error('[admin courses] Sanity filter failed, fallback active:', error);
    all = await getActiveCourses(admin);
  }
  const pageCount = Math.max(1, Math.ceil(all.length / COURSES_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const slice = all.slice(safePage * COURSES_PER_PAGE, safePage * COURSES_PER_PAGE + COURSES_PER_PAGE);

  const lines = [
    '🎓 Курсы',
    '',
    'Показываются только курсы из Sanity.',
    'Структура модулей и уроков — в кабинете на сайте.',
    '',
  ];
  for (const c of slice) {
    const n = await countCourseStudents(admin, c.id);
    lines.push(`🎓 ${c.title}`, `👨‍🎓 Учеников: ${n}`, courseStatusLine(c), '');
  }
  if (slice.length === 0) lines.push('Нет курсов в Sanity (или не удалось связать с Supabase).');

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
  const [curators, checkers] = await Promise.all([
    listActiveCourseStaff(admin, courseId, 'curator'),
    listActiveCourseStaff(admin, courseId, 'check'),
  ]);
  const curatorId = curators[0]?.staff_telegram_id;
  const checkId = checkers[0]?.staff_telegram_id;

  const lines = [
    `🎓 ${course.title}`,
    '',
    `👨‍🎓 Учеников: ${students}`,
    course.description ? `📄 ${shorten(course.description, 200)}` : '',
    courseStatusLine(course),
    '',
    `📡 Куратор: ${curatorId ?? '—'}`,
    `📝 Проверяющий ДЗ: ${checkId ?? '—'}`,
    '',
    'Модули, уроки, ДЗ и прогресс — на сайте в кабинете staff.',
  ].filter(Boolean);

  const keyboard: InlineButton[][] = [
    [{ text: '👥 Сотрудники курса', callback_data: `ae:cs:${courseId}:m` }],
    [{ text: '👨‍🎓 Ученики курса', callback_data: `ae:ls:course:0` }],
    [{ text: '❤️ Жизни курса', callback_data: `ae:lives:c:${courseId}` }],
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

export async function handleEducationHubAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
): Promise<boolean> {
  if (data === 'ae:menu') {
    return false;
  }
  if (isLivesHubAction(data)) {
    return handleLivesHubAction(admin, data, message);
  }
  if (data.startsWith('ae:courses:')) {
    const page = Number(data.slice('ae:courses:'.length)) || 0;
    await renderCoursesList(admin, message, page);
    return true;
  }
  const courseMatch = data.match(/^ae:course:(\d+)$/);
  if (courseMatch) {
    await renderCourseDetail(admin, message, Number(courseMatch[1]));
    return true;
  }
  if (data.startsWith('ae:ind:')) {
    const page = Number(data.slice('ae:ind:'.length)) || 0;
    await renderIndividualList(admin, message, page);
    return true;
  }
  if (data === 'ae:migrate:staff') {
    const { runMigrateStaffRoles } = await import('./migrate-staff-roles');
    const preview = await runMigrateStaffRoles(admin, { dryRun: true, assignLegacy: false });
    await editAdminMessage(
      message,
      [
        '🔄 Миграция staff (preview, dry-run)',
        '',
        `primary → staff: ${preview.primaryUpdates}`,
        `очистка extra curator/check: ${preview.extraUpdates}`,
        `новые назначения (без --assign-legacy): ${preview.assignmentsCreated}`,
        '',
        'Применить на сервере:',
        'npm run migrate:staff',
        'С legacy-назначениями на все курсы:',
        'npx tsx scripts/migrate-staff-roles.ts --assign-legacy',
      ].join('\n'),
      {
        inline_keyboard: [
          [{ text: '✅ Применить (dry-run + legacy)', callback_data: 'ae:migrate:staff:apply' }],
          [{ text: '⬅️ Обучение', callback_data: 'ae:menu' }],
          [homeButton()],
        ],
      },
    );
    return true;
  }
  if (data === 'ae:migrate:staff:apply') {
    const { runMigrateStaffRoles } = await import('./migrate-staff-roles');
    const applied = await runMigrateStaffRoles(admin, { dryRun: false, assignLegacy: true });
    await editAdminMessage(
      message,
      [
        '✅ Миграция staff выполнена',
        '',
        `primary → staff: ${applied.primaryUpdates}`,
        `extra очищено: ${applied.extraUpdates}`,
        `назначений создано: ${applied.assignmentsCreated}`,
      ].join('\n'),
      {
        inline_keyboard: [[{ text: '⬅️ Обучение', callback_data: 'ae:menu' }], [homeButton()]],
      },
    );
    return true;
  }
  return false;
}
