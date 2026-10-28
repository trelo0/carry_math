/**
 * Статические инварианты маршрутизации guest / student / check (Topics).
 * npx tsx scripts/test-guest-student-check-routing.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}`);
  }
}

const support = read('src/lib/bot/studentSupportFlow.ts');
const guestInquiry = read('src/lib/bot/guest-course-inquiry-flow.ts');
const mentor = read('src/lib/bot/studentMentorFlow.ts');
const messaging = read('src/lib/bot/staff/messaging.ts');
const overdue = read('src/lib/bot/education/homework-deadline-notify.ts');
const cabinet = read('src/lib/bot/admin/course-cabinet-notify.ts');
const inbox = read('src/lib/bot/admin/admin-guest-inbox.ts');

console.log('guest / student / check — маршрутизация\n');

check(
  'guest/student support → admin topic при STAFF_DM_TOPICS',
  support.includes('deliverStudentPlainToStaffTopic') &&
    support.includes('notifyAdminClientContactPing'),
);
check(
  'guest course inquiry → notifyPrimaryAdminMainChatInbox (topics: topic+ping)',
  guestInquiry.includes('notifyPrimaryAdminMainChatInbox'),
);
check(
  'admin contact callback ah:msg:w',
  read('src/lib/bot/admin/admin-dm-topic.ts').includes('ah:msg:w:'),
);
check(
  'HW submit check → skipTopic',
  mentor.includes('skipTopic: isHwSubmit && staffRole === \'check\''),
);
check(
  'notifyStaffInbound topics: check | admin | curator',
  /topicRole === 'check' \|\| topicRole === 'admin' \|\| topicRole === 'curator'/.test(messaging),
);
check(
  'просрочка ДЗ check → бот, не topic',
  !overdue.includes('deliverInboundToStaffTopic'),
);
check(
  'кабинет + topics → только пуш Связаться, без inbox insert',
  cabinet.includes('staffDmTopicsEnabled()') &&
    /if \(!staffDmTopicsEnabled\(\)\)/.test(cabinet) &&
    cabinet.includes('adminClientTopicCallback'),
);
check(
  'admin inbox/topics: deliverInbound + contact ping',
  inbox.includes('deliverInboundToStaffTopic') && inbox.includes('notifyAdminClientContactPing'),
);

console.log(`\n${passed} ok, ${failed} fail`);
process.exit(failed > 0 ? 1 : 0);
