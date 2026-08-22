// Проверка меню ученика по направлениям: getUserContext + getStudentUiMode +
// buildStudentMainMenu на реальных записях bot_members/user_accesses.
// Запуск: npx tsx scripts/test-student-menu.ts
// Тестовые пользователи 999999003–999999009 полностью удаляются в конце.

import { readFileSync } from 'node:fs';
import { createAdminClient } from '../src/lib/supabase/admin';
import { expireAccesses, getUserContext, grantAccess, revokeAccess, hasActiveAccess } from '../src/lib/bot/accesses';
import {
  STUDENT_HOME_LABEL,
  buildStudentMainMenu,
  getLessonsDirectionLabel,
  getStudentCabinetUrl,
  getStudentUiMode,
  isStudentWelcomed,
  markStudentWelcomed,
} from '../src/lib/bot/studentFlow';

// Next.js подхватывает .env.local сам; при запуске скриптом читаем вручную.
for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const admin = createAdminClient();

const A = 999999003; // student + course
const B = 999999004; // student + individual
const C = 999999005; // student + course + individual
const D = 999999006; // student + course (просрочен)
const E = 999999007; // student + course + group
const F = 999999008; // student + group
const G = 999999009; // student + course + individual + group
const ALL = [A, B, C, D, E, F, G];

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

async function cleanup(): Promise<void> {
  await admin.from('user_accesses').delete().in('telegram_id', ALL);
  await admin.from('bot_conversation_states').delete().in('telegram_id', ALL);
  await admin.from('bot_members').delete().in('telegram_id', ALL);
}

// Плоские ряды клавиатуры: ['a', 'b|c'] — удобно сравнивать целиком.
async function menuRows(telegramId: number): Promise<string[]> {
  const context = await getUserContext(admin, telegramId);
  if (!context) throw new Error(`нет контекста для ${telegramId}`);
  const main = buildStudentMainMenu(context);
  if (!main.keyboard) return [];
  return main.keyboard.keyboard.map((row) => row.map((b) => b.text).join(' | '));
}

async function main(): Promise<void> {
  await cleanup();

  for (const id of ALL) {
    const { error } = await admin
      .from('bot_members')
      .insert({ telegram_id: id, role: 'student', full_name: `Student Test ${id}` });
    if (error) throw error;
  }

  await grantAccess(admin, A, 'course');
  await grantAccess(admin, B, 'individual');
  await grantAccess(admin, C, 'course');
  await grantAccess(admin, C, 'individual');
  await grantAccess(admin, D, 'course', { expiresAt: new Date(Date.now() - 86400000).toISOString() });
  await grantAccess(admin, E, 'course');
  await grantAccess(admin, E, 'group');
  await grantAccess(admin, F, 'group');
  await grantAccess(admin, G, 'course');
  await grantAccess(admin, G, 'individual');
  await grantAccess(admin, G, 'group');
  // Служебное истечение: active с прошедшим expires_at → expired.
  const expired = await expireAccesses(admin, { telegramId: D });
  check('expireAccesses перевёл просроченный доступ в expired', expired === 1);

  console.log('Тест 1: только course — сразу меню курса, без выбора');
  {
    const context = await getUserContext(admin, A);
    check('режим course', context !== null && getStudentUiMode(context) === 'course');
    const rows = await menuRows(A);
    check(
      'кнопки курса + кабинет, без «Назад»',
      JSON.stringify(rows) === JSON.stringify([
        '📚 Сдать ДЗ ментору',
        '🆘 Получить помощь',
        '📅 Ближайшее занятие',
        STUDENT_HOME_LABEL,
      ]),
    );
  }

  console.log('Тест 2: только individual — сразу меню занятий');
  {
    const context = await getUserContext(admin, B);
    check('режим lessons', context !== null && getStudentUiMode(context) === 'lessons');
    check(
      'подпись «ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ»',
      context !== null && getLessonsDirectionLabel(context) === '📚 ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ',
    );
    const rows = await menuRows(B);
    check(
      'кнопки занятий + кабинет',
      JSON.stringify(rows) === JSON.stringify([
        '📅 Следующее занятие',
        '💬 Задать вопрос наставнику',
        '📝 Сдать домашку',
        STUDENT_HOME_LABEL,
      ]),
    );
  }

  console.log('Тест 3: только group — то же меню занятий, отдельного интерфейса нет');
  {
    const context = await getUserContext(admin, F);
    check('режим lessons', context !== null && getStudentUiMode(context) === 'lessons');
    check('короткая подпись «МОИ ЗАНЯТИЯ»', context !== null && getLessonsDirectionLabel(context) === '👥 МОИ ЗАНЯТИЯ');
    const rows = await menuRows(F);
    check('меню идентично individual', rows.length === 4 && rows[0] === '📅 Следующее занятие');
  }

  console.log('Тест 4: course + individual — экран выбора направления');
  {
    const context = await getUserContext(admin, C);
    check('режим both', context !== null && getStudentUiMode(context) === 'both');
    const rows = await menuRows(C);
    check(
      'КУРС | ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ | ЛИЧНЫЙ КАБИНЕТ',
      JSON.stringify(rows) === JSON.stringify(['🎓 КУРС', '📚 ИНДИВИДУАЛЬНЫЕ ЗАНЯТИЯ', STUDENT_HOME_LABEL]),
    );
  }

  console.log('Тест 5: course + group — выбор с короткой подписью занятий');
  {
    const rows = await menuRows(E);
    check(
      'КУРС | МОИ ЗАНЯТИЯ | ЛИЧНЫЙ КАБИНЕТ',
      JSON.stringify(rows) === JSON.stringify(['🎓 КУРС', '👥 МОИ ЗАНЯТИЯ', STUDENT_HOME_LABEL]),
    );
  }

  console.log('Тест 6: course + individual + group — два направления, не три');
  {
    const context = await getUserContext(admin, G);
    check('режим both', context !== null && getStudentUiMode(context) === 'both');
    const rows = await menuRows(G);
    check('ровно 3 кнопки: КУРС, МОИ ЗАНЯТИЯ, кабинет', rows.length === 3 && rows[0] === '🎓 КУРС');
  }

  console.log('Тест 7: без активных доступов (course = expired)');
  {
    const context = await getUserContext(admin, D);
    check('просроченный курс не активен', context !== null && context.accesses.course === false);
    check('hasActiveAccess согласен', (await hasActiveAccess(admin, D, 'course')) === false);
    check('режим none', context !== null && getStudentUiMode(context) === 'none');
    const main = context ? buildStudentMainMenu(context) : null;
    check('сообщение без клавиатуры', main !== null && main.keyboard === null);
  }

  console.log('Тест 8: отмена доступа переключает режим');
  {
    await revokeAccess(admin, C, 'individual');
    const contextAfterRevoke = await getUserContext(admin, C);
    check('после revoke — только course', contextAfterRevoke !== null && getStudentUiMode(contextAfterRevoke) === 'course');
    await grantAccess(admin, C, 'individual'); // повторная выдача после отмены
    const contextRestored = await getUserContext(admin, C);
    check('повторная выдача возвращает both', contextRestored !== null && getStudentUiMode(contextRestored) === 'both');
  }

  console.log('Тест 9: не-ученик не получает меню ученика');
  {
    await admin.from('bot_members').update({ role: 'guest' }).eq('telegram_id', B);
    const context = await getUserContext(admin, B);
    check('контекст гостя: роль guest', context?.role === 'guest');
    // effectiveRole в handleStudentMessage вернёт guest → нажатия не обрабатываются.
    await admin.from('bot_members').update({ role: 'student' }).eq('telegram_id', B);
  }

  console.log('Тест 10: одноразовое приветствие');
  {
    check('до отметки приветствие не отправлялось', (await isStudentWelcomed(admin, A)) === false);
    await markStudentWelcomed(admin, A, 1);
    check('после отметки — отправлено', (await isStudentWelcomed(admin, A)) === true);
    const { data: state } = await admin
      .from('bot_conversation_states')
      .select('step')
      .eq('telegram_id', A)
      .maybeSingle();
    check('отметка хранится в bot_conversation_states', state?.step === 'student:welcomed');
  }

  console.log('Тест 11: ссылка на личный кабинет');
  {
    const url = getStudentCabinetUrl();
    check('URL ведёт на /account сайта', /^https?:\/\/.+\/account$/.test(url));
    console.log(`  → ${url}`);
  }

  console.log('\nСформированные меню:');
  for (const [label, id] of [['A', A], ['B', B], ['C', C], ['D', D], ['E', E], ['F', F], ['G', G]] as const) {
    const rows = await menuRows(id);
    console.log(`  Пользователь ${label}: ${rows.length > 0 ? rows.join(' || ') : '«У вас пока нет активных учебных программ.»'}`);
  }

  await cleanup();
  console.log(`\nИтог: ${passed} пройдено, ${failed} провалено.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Тест не выполнен:', error);
  process.exitCode = 1;
});
