/**
 * Смoke: метрики главной админа (нужен .env.local + Supabase).
 * npx tsx scripts/test-admin-hub.ts
 */
import { readFileSync } from 'node:fs';
import { createAdminClient } from '../src/lib/supabase/admin';
import { fetchAdminHubMetrics, attentionTaskCount } from '@/lib/bot/admin/hub-metrics';

for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

async function main(): Promise<void> {
  const admin = createAdminClient();
  const m = await fetchAdminHubMetrics(admin);
  console.log('metrics', m);
  console.log('attention', attentionTaskCount(m));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
