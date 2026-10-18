/**
 * npx tsx scripts/migrate-staff-roles.ts --dry-run
 * npx tsx scripts/migrate-staff-roles.ts --assign-legacy --dry-run
 */

import { createAdminClient } from '../src/lib/supabase/admin';
import { runMigrateStaffRoles } from '../src/lib/bot/admin/migrate-staff-roles';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const assignLegacy = args.has('--assign-legacy');

async function main() {
  const admin = createAdminClient();
  const result = await runMigrateStaffRoles(admin, { dryRun, assignLegacy });
  console.log(
    `Готово${dryRun ? ' (dry-run)' : ''}: primary→staff ${result.primaryUpdates}, extra cleaned ${result.extraUpdates}, assignments ${result.assignmentsCreated}`,
  );
  if (!assignLegacy) {
    console.log('Подсказка: --assign-legacy — назначения на все курсы для legacy curator/check.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
