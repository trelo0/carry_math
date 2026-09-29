// Проверка commit slots: remaining − scheduled = available.
// Запуск: node scripts/test-lesson-credits.mjs

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

const STUDENT = 999999301;

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

async function countScheduled(packageId) {
  const { count } = await admin
    .from('scheduled_lessons')
    .select('id', { count: 'exact', head: true })
    .eq('package_id', packageId)
    .eq('status', 'scheduled');
  return count ?? 0;
}

async function cleanup() {
  await admin.from('scheduled_lessons').delete().eq('telegram_id', STUDENT);
  await admin.from('lesson_packages').delete().eq('telegram_id', STUDENT);
  await admin.from('bot_members').delete().eq('telegram_id', STUDENT);
}

async function main() {
  await cleanup();
  const { error: memberError } = await admin.from('bot_members').insert({
    telegram_id: STUDENT,
    role: 'student',
    full_name: 'Credit Test',
  });
  if (memberError) throw memberError;

  const { data: pkg, error: pkgError } = await admin
    .from('lesson_packages')
    .insert({
      telegram_id: STUDENT,
      product: 'individual',
      title: 'Test 2',
      total_lessons: 2,
      remaining_lessons: 2,
      used_lessons: 0,
      status: 'active',
    })
    .select('id')
    .single();
  if (pkgError) throw pkgError;

  console.log('1. available = remaining − scheduled:');
  {
    const scheduled = await countScheduled(pkg.id);
    check('0 scheduled → available 2', scheduled === 0 && 2 - scheduled === 2);
  }

  console.log('2. scheduled занимает commit slot без списания remaining:');
  {
    const startsAt = new Date(Date.now() + 86400000).toISOString();
    const { error } = await admin.from('scheduled_lessons').insert({
      telegram_id: STUDENT,
      kind: 'individual',
      package_id: pkg.id,
      starts_at: startsAt,
      duration_minutes: 60,
      topic: 'Test',
      status: 'scheduled',
    });
    check('insert scheduled', !error);

    const { data: pkgRow } = await admin
      .from('lesson_packages')
      .select('remaining_lessons')
      .eq('id', pkg.id)
      .single();
    const scheduled = await countScheduled(pkg.id);
    check('remaining still 2', pkgRow?.remaining_lessons === 2);
    check('available = 1', 2 - scheduled === 1);
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
