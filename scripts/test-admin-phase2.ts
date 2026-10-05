/**
 * Smoke: staff roster + student filter ids (Supabase + .env.local).
 * npx tsx scripts/test-admin-phase2.ts
 */
import { readFileSync } from 'node:fs';
import { createAdminClient } from '../src/lib/supabase/admin';
import { listStaffMembers, listMentorPickerCandidates } from '@/lib/bot/admin/staff-roster';

for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

async function main(): Promise<void> {
  const admin = createAdminClient();
  const staff = await listStaffMembers(admin, 0, 10);
  console.log('staff total', staff.total, 'page', staff.members.length);
  const teachers = await listMentorPickerCandidates(admin, 'teacher');
  console.log('teacher pickers', teachers.length);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
