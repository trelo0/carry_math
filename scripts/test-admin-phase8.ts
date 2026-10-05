/**
 * Smoke: admin action log table.
 * npx tsx scripts/test-admin-phase8.ts
 */
import { readFileSync } from 'node:fs';
import { createAdminClient } from '../src/lib/supabase/admin';

for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

async function main(): Promise<void> {
  const admin = createAdminClient();
  try {
    const { count } = await admin
      .from('admin_action_log')
      .select('id', { count: 'exact', head: true });
    console.log('admin_action_log rows', count ?? 0);
  } catch (e) {
    console.log('admin_action_log missing — run supabase/admin_action_log.sql');
    console.error(e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
