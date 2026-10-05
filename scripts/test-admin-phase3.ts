/**
 * Smoke: unified leads list + source filter ids.
 * npx tsx scripts/test-admin-phase3.ts
 */
import { readFileSync } from 'node:fs';
import { createAdminClient } from '../src/lib/supabase/admin';
import { parseLeadTelegramId } from '@/lib/bot/admin/leads';

for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

async function main(): Promise<void> {
  const admin = createAdminClient();
  const { count: total } = await admin.from('leads').select('id', { count: 'exact', head: true });
  const { count: botCount } = await admin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'telegram_bot');
  const { data: sample } = await admin.from('leads').select('comment, source').limit(3);
  console.log('leads total', total ?? 0, 'telegram_bot', botCount ?? 0);
  for (const row of sample ?? []) {
    const tg = parseLeadTelegramId((row as { comment: string | null }).comment);
    console.log('sample source', (row as { source: string | null }).source, 'tg', tg);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
