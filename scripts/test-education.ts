// Проверка учебного слоя: courses, groups, mentor_assignments.
// Запуск: npx tsx scripts/test-education.ts
// Тестовые пользователи 999999031–999999044 и тестовый курс/группа
// полностью удаляются в конце.

import { readFileSync } from 'node:fs';
import { createAdminClient } from '../src/lib/supabase/admin';
import { grantAccess } from '../src/lib/bot/accesses';
import {
  createCourse,
  getActiveCourses,
  getStudentCourses,
  enrollStudent,
  removeStudentFromCourse,
  updateCourse,
} from '../src/lib/bot/education/courses';
import {
  createGroup,
  addStudentToGroup,
  getGroupMembers,
  getStudentGroups,
} from '../src/lib/bot/education/groups';
import {
  assignCurator,
  assignTeacher,
  getStudentCurator,
  getStudentTeacher,
  removeAssignment,
} from '../src/lib/bot/education/assignments';

// Next.js подхватывает .env.local сам; при запуске скриптом читаем вручную.
for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const admin = createAdminClient();

const T1 = 999999031; // преподаватель 1
const T2 = 999999032; // преподаватель 2
const CU = 999999033; // куратор
const S1 = 999999041; // course: зачисление + куратор
const S2 = 999999042; // individual: преподаватель + куратор
const S3 = 999999043; // course + individual: всё вместе
const S4 = 999999044; // group: группа с преподавателем и куратором
const ALL = [T1, T2, CU, S1, S2, S3, S4];

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean): void {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}`);
  }
}

let groupId = 0;
let courseId = 0;

async function cleanup(): Promise<void> {
  // bot_members cascade уносит зачисления, назначения и состав групп.
  await admin.from('bot_members').delete().in('telegram_id', ALL);
  if (groupId) await admin.from('groups').delete().eq('id', groupId);
  if (courseId) await admin.from('courses').delete().eq('id', courseId);
}

async function main(): Promise<void> {
  await cleanup();

  for (const [id, role, name] of [
    [T1, 'teacher', 'Test Teacher 1'],
    [T2, 'teacher', 'Test Teacher 2'],
    [CU, 'curator', 'Test Curator'],
    [S1, 'student', 'Test Student 1'],
    [S2, 'student', 'Test Student 2'],
    [S3, 'student', 'Test Student 3'],
    [S4, 'student', 'Test Student 4'],
  ] as const) {
    const { error } = await admin.from('bot_members').insert({ telegram_id: id, role, full_name: name });
    if (error) throw error;
  }

  console.log('Курсы:');
  const course = await createCourse(admin, {
    title: 'Тестовый курс District',
    slug: `test-course-${Date.now()}`,
    description: 'Служебный курс для проверки учебного слоя.',
  });
  courseId = course.id;
  check('createCourse создаёт курс', course.is_active === true && Boolean(course.slug));
  check('getActiveCourses видит курс', (await getActiveCourses(admin)).some((c) => c.id === course.id));
  const renamed = await updateCourse(admin, course.id, { title: 'Тестовый курс District v2' });
  check('updateCourse меняет название', renamed.title === 'Тестовый курс District v2');

  console.log('Доступы (user_accesses) — отдельный слой:');
  await grantAccess(admin, S1, 'course');
  await grantAccess(admin, S2, 'individual');
  await grantAccess(admin, S3, 'course');
  await grantAccess(admin, S3, 'individual');
  await grantAccess(admin, S4, 'group');
  check('доступы выданы без ошибок', true);

  console.log('Ученик 1: student + course access + зачисление + куратор:');
  await enrollStudent(admin, S1, course.id);
  const s1Courses = await getStudentCourses(admin, S1);
  check('зачисление активно, курс виден', s1Courses.length === 1 && s1Courses[0].course.title === 'Тестовый курс District v2');
  await assignCurator(admin, S1, CU);
  const s1Curator = await getStudentCurator(admin, S1);
  check('куратор — персональное назначение', s1Curator?.telegramId === CU && s1Curator.source === 'personal');
  check('у ученика без группы нет преподавателя', (await getStudentTeacher(admin, S1)) === null);

  console.log('Ученик 2: student + individual + преподаватель + куратор:');
  await assignTeacher(admin, S2, T1);
  await assignCurator(admin, S2, CU);
  const s2Teacher = await getStudentTeacher(admin, S2);
  check('преподаватель назначен', s2Teacher?.telegramId === T1 && s2Teacher.fullName === 'Test Teacher 1');
  check('куратор назначен', (await getStudentCurator(admin, S2))?.telegramId === CU);

  console.log('Ученик 3: course + individual, всё вместе:');
  await enrollStudent(admin, S3, course.id);
  await assignTeacher(admin, S3, T1);
  await assignCurator(admin, S3, CU);
  check('курсы ученика 3', (await getStudentCourses(admin, S3)).length === 1);
  check('преподаватель ученика 3', (await getStudentTeacher(admin, S3))?.telegramId === T1);
  check('куратор ученика 3', (await getStudentCurator(admin, S3))?.telegramId === CU);

  console.log('Ученик 4: group — группа с преподавателем и куратором:');
  const group = await createGroup(admin, {
    title: 'Тестовая группа 5–7 класс',
    courseId: course.id,
    teacherTelegramId: T1,
    curatorTelegramId: CU,
  });
  groupId = group.id;
  await addStudentToGroup(admin, group.id, S4);
  const members = await getGroupMembers(admin, group.id);
  check('состав группы: ученик 4 с именем', members.length === 1 && members[0].full_name === 'Test Student 4');
  const s4Groups = await getStudentGroups(admin, S4);
  check('моя группа ученика 4', s4Groups.length === 1 && s4Groups[0].title === 'Тестовая группа 5–7 класс');
  const s4Teacher = await getStudentTeacher(admin, S4);
  check('преподаватель взят из группы (fallback)', s4Teacher?.telegramId === T1 && s4Teacher.source === 'group');
  const s4Curator = await getStudentCurator(admin, S4);
  check('куратор взят из группы (fallback)', s4Curator?.telegramId === CU && s4Curator.source === 'group');

  console.log('Валидация ролей на сервере:');
  {
    let rejected = false;
    try {
      await assignCurator(admin, S1, T1); // преподаватель не может быть куратором
    } catch {
      rejected = true;
    }
    check('teacher отклонён как куратор', rejected);

    rejected = false;
    try {
      await assignTeacher(admin, S1, S2); // ученик не может быть преподавателем
    } catch {
      rejected = true;
    }
    check('student отклонён как преподаватель', rejected);

    rejected = false;
    try {
      await assignTeacher(admin, S1, 987654321); // не зарегистрирован
    } catch {
      rejected = true;
    }
    check('незарегистрированный наставник отклонён', rejected);
  }

  console.log('Замена назначения и снятие:');
  {
    await assignTeacher(admin, S2, T2);
    const replaced = await getStudentTeacher(admin, S2);
    check('новое назначение заменило старое', replaced?.telegramId === T2);
    const { count } = await admin
      .from('mentor_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('telegram_id', S2)
      .eq('kind', 'teacher')
      .eq('status', 'completed');
    check('предыдущее назначение сохранено как completed', count === 1);

    check('removeAssignment снимает куратора', await removeAssignment(admin, S1, 'curator'));
    check('куратор ученика 1 больше не находится', (await getStudentCurator(admin, S1)) === null);
  }

  console.log('Отчисление и история:');
  {
    check('removeStudentFromCourse отчисляет', await removeStudentFromCourse(admin, S1, course.id));
    check('активных курсов после отчисления нет', (await getStudentCourses(admin, S1)).length === 0);
    const { count } = await admin
      .from('course_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('telegram_id', S1)
      .eq('course_id', course.id)
      .eq('status', 'cancelled');
    check('история зачисления сохранена (cancelled)', count === 1);
    await enrollStudent(admin, S1, course.id);
    check('повторное зачисление работает', (await getStudentCourses(admin, S1)).length === 1);
  }

  await cleanup();
  console.log(`\nИтог: ${passed} пройдено, ${failed} провалено.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Тест не выполнен:', error);
  process.exitCode = 1;
});
