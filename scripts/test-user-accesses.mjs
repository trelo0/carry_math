// Одноразовая проверка таблицы user_accesses и модуля src/lib/bot/accesses.ts.
// Запуск: node scripts/test-user-accesses.mjs
// Использует test-пользователей (ID 999999001/002) и полностью удаляет их в конце.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

// Читаем .env.local вручную: скрипт запускается вне Next.js.
const env = {};
for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const USER_A = 999999001; // course + individual + просроченный group
const USER_B = 999999002; // проверка каскадного удаления

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}`);
  }
}

const futureIso = (days) => new Date(Date.now() + days * 86400000).toISOString();
const pastIso = (days) => new Date(Date.now() - days * 86400000).toISOString();

async function cleanup() {
  await admin.from('user_accesses').delete().in('telegram_id', [USER_A, USER_B]);
  await admin.from('bot_members').delete().in('telegram_id', [USER_A, USER_B]);
}

async function main() {
  await cleanup();

  // FK требует существование участника в bot_members.
  for (const id of [USER_A, USER_B]) {
    const { error } = await admin.from('bot_members').insert({ telegram_id: id, role: 'student', full_name: 'Access Test' });
    if (error) throw error;
  }

  console.log('1. Выдача доступа course:');
  {
    const { error } = await admin
      .from('user_accesses')
      .insert({ telegram_id: USER_A, product: 'course', status: 'active' });
    check('insert course без ошибок', !error);
    const { data } = await admin.from('user_accesses').select('product, status').eq('telegram_id', USER_A).eq('product', 'course').maybeSingle();
    check('строка course создана, status=active', data?.status === 'active');
  }

  console.log('2. Одновременно course + individual:');
  {
    const { error } = await admin
      .from('user_accesses')
      .insert({ telegram_id: USER_A, product: 'individual', status: 'active', expires_at: futureIso(30) });
    check('insert individual без ошибок', !error);
    const { count } = await admin
      .from('user_accesses')
      .select('id', { count: 'exact', head: true })
      .eq('telegram_id', USER_A)
      .eq('status', 'active');
    check('у одного пользователя два активных продукта', count === 2);
  }

  console.log('3. Просроченный и отменённый доступы не активны:');
  {
    const { error } = await admin
      .from('user_accesses')
      .insert({ telegram_id: USER_A, product: 'group', status: 'active', expires_at: pastIso(1) });
    check('insert group (в прошлом) без ошибок', !error);

    // Логика isAccessActive повторяет правило: active + срок в будущем или null.
    const { data: rows } = await admin.from('user_accesses').select('product, status, expires_at').eq('telegram_id', USER_A);
    const isActive = (row) => row.status === 'active' && (!row.expires_at || new Date(row.expires_at) > new Date());
    const active = (rows ?? []).filter(isActive).map((row) => row.product).sort();
    check('просроченный group не считается активным', JSON.stringify(active) === JSON.stringify(['course', 'individual']));

    const { error: cancelError } = await admin
      .from('user_accesses')
      .update({ status: 'cancelled' })
      .eq('telegram_id', USER_A)
      .eq('product', 'individual');
    check('отмена individual без ошибок', !cancelError);
    const { data: after } = await admin.from('user_accesses').select('product, status, expires_at').eq('telegram_id', USER_A);
    const activeAfter = (after ?? []).filter(isActive).map((row) => row.product);
    check('отменённый individual не считается активным', JSON.stringify(activeAfter) === JSON.stringify(['course']));
  }

  console.log('4. Служебное истечение (active с прошедшим expires_at → expired):');
  {
    const nowIso = new Date().toISOString();
    const { data, error } = await admin
      .from('user_accesses')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('telegram_id', USER_A)
      .eq('status', 'active')
      .not('expires_at', 'is', null)
      .lte('expires_at', nowIso)
      .select('id');
    check('expire-запрос без ошибок', !error);
    check('просроченный active переведён в expired (1 строка)', (data ?? []).length === 1);
    // У USER_A просрочен был group: проверим его статус.
    const { data: group } = await admin.from('user_accesses').select('status').eq('telegram_id', USER_A).eq('product', 'group').maybeSingle();
    check('group теперь expired', group?.status === 'expired');
  }

  console.log('5. Каскадное удаление (bot_members → user_accesses):');
  {
    await admin.from('bot_members').insert({ telegram_id: USER_B, role: 'guest' });
    await admin.from('user_accesses').insert({ telegram_id: USER_B, product: 'course', status: 'active' });
    const { error } = await admin.from('bot_members').delete().eq('telegram_id', USER_B);
    check('удаление участника без ошибок', !error);
    const { count } = await admin
      .from('user_accesses')
      .select('id', { count: 'exact', head: true })
      .eq('telegram_id', USER_B);
    check('доступы удалены каскадно', count === 0);
  }

  console.log('6. Ограничения таблицы:');
  {
    const { error: badProduct } = await admin.from('user_accesses').insert({ telegram_id: USER_A, product: 'vip' });
    check('неизвестный продукт отклонён (check)', Boolean(badProduct));
    const { error: badFk } = await admin.from('user_accesses').insert({ telegram_id: 987654321, product: 'course' });
    check('FK на bot_members работает (нет участника — отказ)', Boolean(badFk));
    const { error: dup } = await admin.from('user_accesses').insert({ telegram_id: USER_A, product: 'course', status: 'active' });
    check('дубликат (telegram_id, product) отклонён (unique)', Boolean(dup));
  }

  await cleanup();
  console.log(`\nИтог: ${passed} пройдено, ${failed} провалено.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Тест не выполнен:', error);
  process.exitCode = 1;
});
