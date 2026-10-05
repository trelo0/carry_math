/**
 * Smoke: package lists for admin finance.
 * npx tsx scripts/test-admin-phase6.ts
 */
import { readFileSync } from 'node:fs';
import { createAdminClient } from '../src/lib/supabase/admin';

for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

async function main(): Promise<void> {
  const admin = createAdminClient();
  const { count: low } = await admin
    .from('lesson_packages')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .lte('remaining_lessons', 2);
  const { count: pending } = await admin
    .from('purchase_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  console.log('packages low', low ?? 0, 'purchase pending', pending ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
