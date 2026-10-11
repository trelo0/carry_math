/**
 * Проверка сценария преподавателя в TG-боте.
 * npx tsx scripts/test-teacher-bot-scenario.ts
 */
import { readFileSync } from 'node:fs';
import { createAdminClient } from '../src/lib/supabase/admin';
import { loadStaffCapabilities } from '../src/lib/bot/staff/capabilities';
import { resolveStaffBotMode, TEACHER_BOT_MENU_LABELS } from '../src/lib/bot/staff/staff-menu';
import { loadTeacherBotSnapshot } from '../src/lib/bot/staff/teacher-data';
import {
  renderTeacherHomeworkHub,
  renderTeacherMessagesInbox,
} from '../src/lib/bot/staff/teacher-messages-screens';
import {
  renderTeacherIndividualList,
  renderTeacherScheduleHome,
  renderTeacherScheduleToday,
  renderTeacherScheduleUpcoming,
  renderTeacherStudentCard,
  renderTeacherStudentsHub,
} from '../src/lib/bot/staff/teacher-screens';
import { listTeacherThreads } from '../src/lib/bot/staff/messaging';
import {
  filterHomeworkByQueue,
  loadTeacherHomeworkItems,
} from '../src/lib/bot/staff/teacher-homework';
import { TEACHER_MENU_LABEL_SET, teacherReplyKeyboard } from '../src/lib/bot/teacher/teacherFlow';

for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const admin = createAdminClient();
let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function staticMenuChecks(): void {
  console.log('\n== Меню преподавателя ==');
  const kb = teacherReplyKeyboard();
  const labels = kb.keyboard.flat().map((b) => b.text);
  check('есть Расписание', labels.includes(TEACHER_BOT_MENU_LABELS.schedule));
  check('есть Ученики', labels.includes(TEACHER_BOT_MENU_LABELS.students));
  check('есть Сообщения', labels.includes(TEACHER_BOT_MENU_LABELS.messages));
  check('есть ДЗ', labels.includes(TEACHER_BOT_MENU_LABELS.homework));
  check('есть Панель', labels.includes(TEACHER_BOT_MENU_LABELS.cabinet));
  check('все лейблы в SET', [...TEACHER_MENU_LABEL_SET].every((l) => labels.includes(l)));

  const flowSrc = readFileSync(
    new URL('../src/lib/bot/teacher/teacherFlow.ts', import.meta.url),
    'utf8',
  );
  check('callback: расписание сегодня', flowSrc.includes("id === 'today'"));
  check('callback: предстоящие', flowSrc.includes("id === 'up'"));
  check('callback: карточка ученика', flowSrc.includes("case 'st'"));
  check('callback: принять ДЗ', flowSrc.includes("id === 'ok'"));
  check('callback: на доработку', flowSrc.includes("id === 'rev'"));
  check('callback: кабинет', flowSrc.includes("case 'cab'"));
  check('сообщения: ответ ученику', flowSrc.includes("id === 'w'"));
}

async function findTeacherTelegramId(): Promise<number | null> {
  // Только role=teacher (не «кто ведёт занятия», иначе попадёт curator).
  const { data } = await admin
    .from('bot_members')
    .select('telegram_id, role')
    .eq('role', 'teacher')
    .limit(5);
  if (data?.[0]?.telegram_id) return data[0].telegram_id as number;

  const { data: withExtra } = await admin
    .from('bot_members')
    .select('telegram_id, extra_roles')
    .contains('extra_roles', ['teacher'])
    .limit(5);
  return (withExtra?.[0]?.telegram_id as number | undefined) ?? null;
}

async function runtimeChecks(teacherId: number): Promise<void> {
  console.log(`\n== Runtime teacher ${teacherId} ==`);

  const caps = await loadStaffCapabilities(admin, teacherId);
  check('canTeacherBot', caps.canTeacherBot === true, `role=${caps.effectiveRole}`);
  const mode = resolveStaffBotMode(caps);
  check(
    'режим teacher_only или combined',
    mode === 'teacher_only' || mode === 'combined',
    `mode=${mode}`,
  );

  const snapshot = await loadTeacherBotSnapshot(admin, teacherId);
  check('snapshot загружен', Array.isArray(snapshot.students));

  const schHome = renderTeacherScheduleHome(snapshot);
  check('экран расписания', schHome.text.includes('РАСПИСАНИЕ'));
  check('кнопка сегодня', schHome.keyboard.inline_keyboard.some((r) =>
    r.some((b) => 'callback_data' in b && b.callback_data === 't:sch:today'),
  ));
  check('кнопка предстоящие', schHome.keyboard.inline_keyboard.some((r) =>
    r.some((b) => 'callback_data' in b && b.callback_data === 't:sch:up'),
  ));

  const today = renderTeacherScheduleToday(snapshot);
  check('экран сегодня', today.text.includes('СЕГОДНЯ'));
  const up = renderTeacherScheduleUpcoming(snapshot);
  check('экран предстоящие', up.text.includes('ПРЕДСТОЯЩИЕ'));

  const hub = renderTeacherStudentsHub(snapshot);
  check('хаб учеников', hub.text.includes('УЧЕНИКИ'));
  check('хаб показывает счётчики', hub.text.includes('Индивидуальные:'));
  const ind = renderTeacherIndividualList(snapshot);
  check('список индивидуальных', ind.text.includes('ИНДИВИДУАЛЬНЫЕ'));

  if (snapshot.students.length > 0) {
    const student = snapshot.students[0]!;
    const card = renderTeacherStudentCard(snapshot, student);
    check('карточка: осталось занятий', card.text.includes('Осталось занятий:'));
    check('карточка: ближайшее', card.text.includes('Ближайшее занятие:'));
    check(
      'карточка: написать в боте',
      card.keyboard.inline_keyboard.some((r) =>
        r.some((b) => 'callback_data' in b && b.callback_data === `t:msg:w:${student.telegramId}`),
      ),
    );
    check(
      'карточка: tg://user',
      card.keyboard.inline_keyboard.some((r) =>
        r.some((b) => 'url' in b && String(b.url).includes(`tg://user?id=${student.telegramId}`)),
      ),
    );
  } else {
    console.log('  ⏭ нет учеников у преподавателя — карточка пропущена');
  }

  const { threads, storageEnabled } = await listTeacherThreads(admin, teacherId);
  const msg = renderTeacherMessagesInbox(threads, storageEnabled, null);
  check('экран сообщений', msg.text.includes('Сообщения'));

  const hwHub = renderTeacherHomeworkHub(null);
  check('хаб ДЗ', hwHub.text.includes('ДОМАШНИЕ'));
  check(
    'ДЗ: на проверке',
    hwHub.keyboard.inline_keyboard.some((r) =>
      r.some((b) => 'callback_data' in b && b.callback_data === 't:hw:q:pending'),
    ),
  );
  check(
    'ДЗ: на доработке',
    hwHub.keyboard.inline_keyboard.some((r) =>
      r.some((b) => 'callback_data' in b && b.callback_data === 't:hw:q:revision'),
    ),
  );

  try {
    const items = await loadTeacherHomeworkItems(admin, teacherId);
    const pending = filterHomeworkByQueue(items, 'pending');
    check('загрузка ДЗ без ошибки', true, `всего=${items.length} pending=${pending.length}`);
  } catch (error) {
    const msgErr = error instanceof Error ? error.message : String(error);
    if (msgErr.includes('homework_assignments') || msgErr.includes('does not exist')) {
      console.log('  ⏭ таблицы ДЗ нет — skip');
    } else {
      check('загрузка ДЗ без ошибки', false, msgErr.slice(0, 120));
    }
  }
}

async function ensurePureTeacherFixture(): Promise<number> {
  const tid = 999999081;
  await admin.from('bot_members').delete().eq('telegram_id', tid);
  const { error } = await admin.from('bot_members').insert({
    telegram_id: tid,
    role: 'teacher',
    full_name: 'Teacher Bot Scenario Fixture',
  });
  if (error) throw error;
  return tid;
}

async function capabilitiesMaskChecks(): Promise<void> {
  console.log('\n== Capabilities /as teacher ==');
  const tid = 999999082;
  await admin.from('bot_members').delete().eq('telegram_id', tid);
  await admin.from('bot_members').insert({
    telegram_id: tid,
    role: 'admin',
    view_role: 'teacher',
    full_name: 'Admin Masked As Teacher',
  });
  try {
    const caps = await loadStaffCapabilities(admin, tid);
    check('/as teacher → canTeacherBot', caps.canTeacherBot && !caps.canCuratorBot);
    check('/as teacher → teacher_only', resolveStaffBotMode(caps) === 'teacher_only');
  } finally {
    await admin.from('bot_members').delete().eq('telegram_id', tid);
  }
}

async function main(): Promise<void> {
  console.log('test-teacher-bot-scenario');
  staticMenuChecks();
  await capabilitiesMaskChecks();

  let fixtureId: number | null = null;
  try {
    let teacherId = await findTeacherTelegramId();
    if (!teacherId) {
      fixtureId = await ensurePureTeacherFixture();
      teacherId = fixtureId;
      console.log(`\n(создан fixture teacher ${teacherId})`);
    }
    await runtimeChecks(teacherId);
  } finally {
    if (fixtureId) {
      await admin.from('bot_members').delete().eq('telegram_id', fixtureId);
    }
  }

  console.log(`\nИтого: ✅ ${passed}  ❌ ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
