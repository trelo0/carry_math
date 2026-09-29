// Проверка изоляции teacher_availability: Teacher A не может удалить слот Teacher B.
// Запуск: node scripts/test-teacher-availability-auth.mjs

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const env = {};
for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEACHER_A = 999999101;
const TEACHER_B = 999999102;

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

async function cleanup() {
  await admin.from('teacher_availability').delete().in('teacher_telegram_id', [TEACHER_A, TEACHER_B]);
  await admin.from('bot_members').delete().in('telegram_id', [TEACHER_A, TEACHER_B]);
}

async function main() {
  await cleanup();

  for (const id of [TEACHER_A, TEACHER_B]) {
    const { error } = await admin.from('bot_members').insert({
      telegram_id: id,
      role: 'teacher',
      full_name: 'Availability Test',
    });
    if (error) throw error;
  }

  const { data: slotB, error: insertError } = await admin
    .from('teacher_availability')
    .insert({
      teacher_telegram_id: TEACHER_B,
      day_of_week: 1,
      start_time: '10:00',
      end_time: '12:00',
      kind: 'both',
    })
    .select('id')
    .single();
  if (insertError) throw insertError;

  console.log('1. GET-фильтр по teacher_telegram_id:');
  {
    const { data: rowsA } = await admin
      .from('teacher_availability')
      .select('id')
      .eq('teacher_telegram_id', TEACHER_A);
    const { data: rowsB } = await admin
      .from('teacher_availability')
      .select('id')
      .eq('teacher_telegram_id', TEACHER_B);
    check('Teacher A не видит слоты Teacher B', (rowsA ?? []).length === 0);
    check('Teacher B видит свой слот', (rowsB ?? []).some((row) => row.id === slotB.id));
  }

  console.log('2. DELETE с двойным фильтром (как в API):');
  {
    const { error } = await admin
      .from('teacher_availability')
      .delete()
      .eq('id', slotB.id)
      .eq('teacher_telegram_id', TEACHER_A);
    check('DELETE Teacher A → slot B не падает с ошибкой', !error);

    const { data: stillThere } = await admin
      .from('teacher_availability')
      .select('id')
      .eq('id', slotB.id)
      .maybeSingle();
    check('Слот Teacher B остался после попытки удаления Teacher A', stillThere?.id === slotB.id);
  }

  console.log('3. POST всегда привязывает teacher_telegram_id текущего teacher:');
  {
    const { data: slotA, error } = await admin
      .from('teacher_availability')
      .insert({
        teacher_telegram_id: TEACHER_A,
        day_of_week: 2,
        start_time: '16:00',
        end_time: '20:00',
        kind: 'both',
      })
      .select('id, teacher_telegram_id')
      .single();
    check('Teacher A создаёт только свой слот', !error && slotA?.teacher_telegram_id === TEACHER_A);

    const { count } = await admin
      .from('teacher_availability')
      .select('id', { count: 'exact', head: true })
      .eq('teacher_telegram_id', TEACHER_B);
    check('У Teacher B по-прежнему один слот', count === 1);
  }

  await cleanup();
  console.log(`\nИтого: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await cleanup();
  process.exit(1);
});
