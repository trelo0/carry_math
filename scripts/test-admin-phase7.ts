/**
 * Smoke: admin comms queues.
 * npx tsx scripts/test-admin-phase7.ts
 */
import { readFileSync } from 'node:fs';
import { createAdminClient } from '../src/lib/supabase/admin';

for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

async function main(): Promise<void> {
  const admin = createAdminClient();
  const { count: hwPending } = await admin
    .from('homework_assignments')
    .select('id', { count: 'exact', head: true })
    .in('review_status', ['submitted', 'reviewing']);
  let unread = 0;
  try {
    const { count } = await admin
      .from('staff_student_messages')
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'student_to_staff')
      .is('staff_read_at', null);
    unread = count ?? 0;
  } catch {
    unread = -1;
  }
  console.log('lesson hw pending', hwPending ?? 0, 'unread staff msgs', unread);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
