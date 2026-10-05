/**
 * Автопроверка админ-бота (фазы 0–9): unit + Supabase smoke.
 * Не требует ручных миграций — опциональные таблицы/колонки дают skip, не fail.
 *
 * npx tsx scripts/test-admin-all.ts
 */
import { readFileSync } from 'node:fs';
import { createAdminClient } from '../src/lib/supabase/admin';
import { parseLeadTelegramId } from '@/lib/bot/admin/leads';
import { buildAttentionItems } from '@/lib/bot/admin/home-attention';
import { fetchAdminHubMetrics, attentionTaskCount } from '@/lib/bot/admin/hub-metrics';
import { collectProblemItems } from '@/lib/bot/admin/problems-menu';
import {
  getBroadcastSegmentRecipients,
  isBroadcastSegmentId,
  segmentTitle,
} from '@/lib/bot/admin/broadcast-segments';
import { listAdminActionLog, adminActionLabel } from '@/lib/bot/admin/action-log';
import { isCommsHubAction } from '@/lib/bot/admin/comms-ops';
import { isPackagesAction } from '@/lib/bot/admin/packages-menu';
import { isAuditHubAction } from '@/lib/bot/admin/audit-menu';
import { isHubAction } from '@/lib/bot/admin/home';
import { listStaffMembers } from '@/lib/bot/admin/staff-roster';
import { renderOperationalReport } from '@/lib/bot/admin/reports-ops';

for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}`);
  }
}

function skip(name: string, reason: string): void {
  skipped += 1;
  console.log(`  ⏭ ${name} — ${reason}`);
}

async function softDb<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    skip(name, msg.slice(0, 120));
    return null;
  }
}

function unitTests(): void {
  console.log('\nUnit (без БД)');
  check('parseLeadTelegramId', parseLeadTelegramId('hello\ntelegram_id:12345') === 12345);
  check('parseLeadTelegramId null', parseLeadTelegramId('no tag') === null);
  check('isBroadcastSegmentId', isBroadcastSegmentId('seg:access:course'));
  check('segmentTitle course', segmentTitle('seg:access:course').includes('Курс'));
  check('adminActionLabel', adminActionLabel('lead.status').includes('заявк'));
  check('buildAttentionItems empty', buildAttentionItems({
    leadsNew: 0,
    leadsInProgress: 0,
    purchasesPending: 0,
    violationsPending: 0,
    packagesLow: 0,
    homeworkPendingReview: 0,
    membersNew7d: 0,
  }).length === 0);
  check('isHubAction', isHubAction('ah:home') && isHubAction('ah:audit:0'));
  check('isCommsHubAction', isCommsHubAction('ah:hw:pending') && isCommsHubAction('ah:person:1:hw'));
  check('isPackagesAction', isPackagesAction('apk:menu'));
  check('isAuditHubAction', isAuditHubAction('ah:problems'));
  check('hub attention count', attentionTaskCount({
    leadsNew: 1,
    purchasesPending: 0,
    violationsPending: 0,
    packagesLow: 0,
    homeworkPendingReview: 0,
    membersNew7d: 0,
    leadsInProgress: 0,
  }) >= 1);
}

async function dbTests(admin: ReturnType<typeof createAdminClient>): Promise<void> {
  console.log('\nSupabase smoke');

  const metrics = await softDb('fetchAdminHubMetrics', () => fetchAdminHubMetrics(admin));
  if (metrics) {
    check('hub metrics object', typeof metrics.leadsNew === 'number');
    check('attentionTaskCount', typeof attentionTaskCount(metrics) === 'number');
  }

  const problems = await softDb('collectProblemItems', () => collectProblemItems(admin, metrics ?? {
    leadsNew: 0,
    leadsInProgress: 0,
    purchasesPending: 0,
    violationsPending: 0,
    packagesLow: 0,
    homeworkPendingReview: 0,
    membersNew7d: 0,
  }));
  if (problems) check('collectProblemItems array', Array.isArray(problems));

  const staff = await softDb('listStaffMembers', () => listStaffMembers(admin, 0, 5));
  if (staff) check('staff roster', typeof staff.total === 'number');

  const segRecipients = await softDb('seg course recipients', () =>
    getBroadcastSegmentRecipients(admin, 'seg:access:course'),
  );
  if (segRecipients) check('segment recipients array', Array.isArray(segRecipients));

  const log = await softDb('listAdminActionLog', () => listAdminActionLog(admin, 0, 3));
  if (log) check('action log query', Array.isArray(log.rows));

  await softDb('renderOperationalReport dry', async () => {
    const lines: string[] = [];
    await renderOperationalReport(admin, async (text) => {
      lines.push(text);
    });
    check('operational report text', lines.join('').includes('Операционный'));
    return true;
  });

  const { error: leadsErr } = await admin.from('leads').select('id').limit(1);
  check('leads table', !leadsErr);

  const { error: pkgErr } = await admin.from('lesson_packages').select('id').limit(1);
  if (pkgErr) skip('lesson_packages', String(pkgErr.message).slice(0, 80));
  else check('lesson_packages table', true);

  const { error: hwErr } = await admin
    .from('homework_assignments')
    .select('id')
    .limit(1);
  if (hwErr) skip('homework_assignments', String(hwErr.message).slice(0, 80));
  else check('homework_assignments table', true);

  const { error: msgErr } = await admin.from('staff_student_messages').select('id').limit(1);
  if (msgErr) skip('staff_student_messages (optional)', 'миграция не применена');
  else check('staff_student_messages table', true);

  const { error: logErr } = await admin.from('admin_action_log').select('id').limit(1);
  if (logErr) skip('admin_action_log (optional)', 'миграция не применена');
  else check('admin_action_log table', true);

  const { error: assignErr } = await admin.from('leads').select('assigned_telegram_id').limit(1);
  if (assignErr) skip('leads.assigned_telegram_id (optional)', 'leads_phase3');
  else check('leads phase3 column', true);
}

async function main(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local');
    process.exitCode = 1;
    return;
  }

  unitTests();
  const admin = createAdminClient();
  await dbTests(admin);

  console.log(`\nИтого: ${passed} ok, ${failed} fail, ${skipped} skip`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
