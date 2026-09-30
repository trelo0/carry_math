// Сценарии guest / client_idle / client_active — меню и фазы без Telegram API.
// Запуск: npx tsx scripts/test-client-bot-scenarios.ts

import { readFileSync } from 'node:fs';
import { createAdminClient } from '../src/lib/supabase/admin';
import { grantAccess, revokeAccess } from '../src/lib/bot/accesses';
import { resolveClientState } from '../src/lib/bot/client-state';
import { buildClientReplyKeyboard, CLIENT_LABELS } from '../src/lib/bot/client-menu';
import {
  embedClientHub,
  hubFromState,
  loadClientHub,
  resetClientDialogToHub,
  saveClientDialogState,
  saveClientHub,
  CLIENT_HUB_STEP,
} from '../src/lib/bot/client-nav';
import { getState } from '../src/lib/bot/admin/core';

for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const admin = createAdminClient();
const IDS = [999999101, 999999102, 999999103, 999999104];

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}`);
  }
}

function rowTexts(telegramId: number, state: Awaited<ReturnType<typeof resolveClientState>>) {
  return buildClientReplyKeyboard(state).keyboard.map((r) => r.map((b) => b.text).join(' | '));
}

async function cleanup(): Promise<void> {
  await admin.from('bot_conversation_states').delete().in('telegram_id', IDS);
  await admin.from('user_accesses').delete().in('telegram_id', IDS);
  await admin.from('bot_members').delete().in('telegram_id', IDS);
}

async function main(): Promise<void> {
  await cleanup();
  for (const id of IDS) {
    await admin.from('bot_members').insert({ telegram_id: id, role: 'guest', full_name: `ClientTest ${id}` });
  }

  const G = IDS[0];
  const IDLE = IDS[1];
  const ACTIVE_COURSE = IDS[2];
  const ACTIVE_LESSONS = IDS[3];

  console.log('1–4: guest phase + меню');
  {
    const state = await resolveClientState(admin, G);
    check('phase guest', state.phase === 'guest');
    const rows = rowTexts(G, state);
    check('3 кнопки гостя', rows.length === 3 && rows[0].includes(CLIENT_LABELS.onlineCourse));
  }

  console.log('5: client_idle');
  {
    await admin.from('bot_members').update({ role: 'student' }).eq('telegram_id', IDLE);
    await admin.from('purchase_requests').insert({
      telegram_id: IDLE,
      product: 'individual',
      package_index: 0,
      title: 'test',
      amount_byn: 1,
      status: 'rejected',
    });
    const state = await resolveClientState(admin, IDLE, { memberRole: 'student' });
    check('phase client_idle', state.phase === 'client_idle');
    const rows = rowTexts(IDLE, state);
    check('есть Купить', rows.some((r) => r.includes(CLIENT_LABELS.buy)));
  }

  console.log('6: active course');
  {
    await grantAccess(admin, ACTIVE_COURSE, 'course');
    await admin.from('bot_members').update({ role: 'student' }).eq('telegram_id', ACTIVE_COURSE);
    const state = await resolveClientState(admin, ACTIVE_COURSE, { memberRole: 'student' });
    check('phase client_active', state.phase === 'client_active');
    const rows = rowTexts(ACTIVE_COURSE, state);
    check('онлайн-курс в меню', rows.some((r) => r.includes(CLIENT_LABELS.onlineCourse)));
  }

  console.log('7–8: active lessons + combo');
  {
    await grantAccess(admin, ACTIVE_LESSONS, 'individual');
    await admin.from('bot_members').update({ role: 'student' }).eq('telegram_id', ACTIVE_LESSONS);
    const state = await resolveClientState(admin, ACTIVE_LESSONS, { memberRole: 'student' });
    check('active lesson product', state.hasActiveLessonProduct);
    const rows = rowTexts(ACTIVE_LESSONS, state);
    check('мои занятия + пакет', rows.some((r) => r.includes(CLIENT_LABELS.myLessons)));
    await grantAccess(admin, ACTIVE_LESSONS, 'course');
    const combo = await resolveClientState(admin, ACTIVE_LESSONS, { memberRole: 'student' });
    const comboRows = rowTexts(ACTIVE_LESSONS, combo);
    const flat = comboRows.join(' ');
    check('курс и занятия без дубля myLessons', (flat.match(/Мои занятия/g) ?? []).length <= 1);
    await revokeAccess(admin, ACTIVE_LESSONS, 'course');
  }

  console.log('14: hub сохраняется при lead-form');
  {
    const tid = G;
    await saveClientHub(admin, tid, { chatId: tid, messageId: 9001 }, 'home');
    await saveClientDialogState(admin, tid, tid, 'client:lead-form', { leadStep: 'name' });
    const hub = await loadClientHub(admin, tid);
    check('hub messageId после lead', hub?.messageId === 9001);
    await resetClientDialogToHub(admin, tid);
    const after = await getState(admin, tid);
    check('после home — client:hub', after?.step === CLIENT_HUB_STEP);
    check('hub в payload', hubFromState(after)?.messageId === 9001);
  }

  await cleanup();
  console.log(`\nИтог: ${passed} пройдено, ${failed} провалено.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
