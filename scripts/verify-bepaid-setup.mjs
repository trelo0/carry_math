/**
 * Smoke-проверка bePaid + Supabase без создания платежа и без webhook.
 * Запуск: node scripts/verify-bepaid-setup.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const env = {};
for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'BEPAY_SHOP_ID',
  'BEPAY_SECRET_KEY',
  'BEPAY_RSA_PUBLIC_KEY',
];

let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log(`  OK  ${name}${detail ? ` — ${detail}` : ''}`);
  else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('=== Env ===');
for (const key of REQUIRED) ok(key, Boolean(env[key]?.trim()));
ok('BEPAY_TEST (optional)', true, env.BEPAY_TEST === 'true' ? 'test checkout enabled' : 'not set → live checkout');

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log('\n=== Schema ===');
const { error: colError } = await admin.from('purchase_requests').select('course_slug, scenario, lessons_count').limit(0);
ok('purchase_requests.course_slug/scenario/lessons_count', !colError, colError?.message ?? '');

console.log('\n=== RPC (service_role) ===');
const fakeId = randomUUID();
const { data: lockData, error: lockError } = await admin.rpc('acquire_processing_lock', { p_id: fakeId });
ok('acquire_processing_lock callable', !lockError, lockError?.message ?? JSON.stringify(lockData));

const { data: fulfillSig } = await admin.rpc('fulfill_purchase_full', {
  p_id: fakeId,
  p_expected_version: 0,
  p_telegram_id: 1,
  p_product: 'course',
  p_amount_byn: 1,
  p_lessons: 1,
  p_title: 'test',
  p_expires_at: null,
  p_course_id: null,
  p_scenario: null,
  p_start_module_id: null,
  p_start_lesson_id: null,
  p_bepaid_transaction_uid: null,
});
ok('fulfill_purchase_full (13 args)', fulfillSig?.reason === 'not_found', JSON.stringify(fulfillSig));

console.log('\n=== RPC (anon — must fail) ===');
if (anonKey) {
  const anon = createClient(url, anonKey);
  const { error: anonError } = await anon.rpc('acquire_processing_lock', { p_id: fakeId });
  ok('anon cannot execute acquire_processing_lock', Boolean(anonError), anonError?.message?.slice(0, 80) ?? 'unexpected success');
} else {
  ok('anon key present', false);
}

console.log('\n=== Site URL ===');
const site = (env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
ok('notification_url path', site.length > 0, `${site}/api/payments/webhook`);

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
