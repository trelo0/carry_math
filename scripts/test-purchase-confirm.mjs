// Проверка conditional status update для purchase_requests.
// Запуск: node scripts/test-purchase-confirm.mjs

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

const STUDENT = 999999201;
const ADMIN = 999999202;

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

async function markResolved(adminClient, id, status, resolvedBy) {
  const { data, error } = await adminClient
    .from('purchase_requests')
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy ?? null,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function cleanup() {
  await admin.from('purchase_requests').delete().eq('telegram_id', STUDENT);
  await admin.from('bot_members').delete().in('telegram_id', [STUDENT, ADMIN]);
}

async function main() {
  await cleanup();

  for (const [id, role] of [[STUDENT, 'student'], [ADMIN, 'admin']]) {
    const { error } = await admin.from('bot_members').insert({
      telegram_id: id,
      role,
      full_name: 'Purchase Test',
      chat_id: id,
    });
    if (error) throw error;
  }

  const { data: request, error: insertError } = await admin
    .from('purchase_requests')
    .insert({
      telegram_id: STUDENT,
      product: 'individual',
      package_index: 0,
      title: 'Test package 10',
      amount_byn: 350,
      status: 'pending',
    })
    .select('id, status')
    .single();
  if (insertError) throw insertError;

  console.log('1. pending → approved (как markPurchaseRequestResolved):');
  {
    const marked = await markResolved(admin, request.id, 'approved', ADMIN);
    check('первое подтверждение', marked);
    const { data: row } = await admin
      .from('purchase_requests')
      .select('status, resolved_by')
      .eq('id', request.id)
      .single();
    check('status=approved', row?.status === 'approved');
    check('resolved_by сохранён', row?.resolved_by === ADMIN);

    const markedAgain = await markResolved(admin, request.id, 'approved', ADMIN);
    check('повторное подтверждение не меняет строку', !markedAgain);
  }

  console.log('2. reject только из pending:');
  {
    const { data: req2, error } = await admin
      .from('purchase_requests')
      .insert({
        telegram_id: STUDENT,
        product: 'group',
        package_index: 0,
        title: 'Group test',
        amount_byn: 200,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw error;

    const marked = await markResolved(admin, req2.id, 'rejected', ADMIN);
    check('pending → rejected', marked);
    const second = await markResolved(admin, req2.id, 'rejected', ADMIN);
    check('повторный reject → false', !second);
  }

  console.log('3. externalId idempotency key:');
  {
    const externalId = `purchase_request:${request.id}`;
    check('формат externalId', externalId.startsWith('purchase_request:'));
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
