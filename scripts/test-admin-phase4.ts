/**
 * Smoke: admin schedule week query.
 * npx tsx scripts/test-admin-phase4.ts
 */
import { readFileSync } from 'node:fs';
import { createAdminClient } from '../src/lib/supabase/admin';

for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

async function main(): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const inWeek = new Date(Date.now() + 7 * 86400000).toISOString();
  const { count } = await admin
    .from('scheduled_lessons')
    .select('id', { count: 'exact', head: true })
    .gte('starts_at', now)
    .lt('starts_at', inWeek)
    .neq('status', 'cancelled');
  const { count: courseAccess } = await admin
    .from('user_accesses')
    .select('telegram_id', { count: 'exact', head: true })
    .eq('product', 'course')
    .eq('status', 'active');
  console.log('upcoming week lessons', count ?? 0, 'course students', courseAccess ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
