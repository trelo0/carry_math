/**
 * Инварианты admin + Topics (без Telegram).
 * npx tsx scripts/test-admin-topic-routing.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

let ok = 0;
let fail = 0;
function check(name: string, pass: boolean): void {
  if (pass) {
    ok += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}`);
  }
}

const cabinet = read('src/lib/bot/admin/course-cabinet-notify.ts');
const inbox = read('src/lib/bot/admin/admin-guest-inbox.ts');
const comms = read('src/lib/bot/admin/comms-ops.ts');
const support = read('src/lib/bot/studentSupportFlow.ts');
const webhook = read('src/app/api/telegram/webhook/route.ts');
const dm = read('src/lib/bot/admin/admin-dm-topic.ts');

console.log('Admin Topics — проверки\n');

check(
  'кабinet: при Topics нет notifyPrimaryAdminMainChatInbox (нет ложных staff_messages)',
  cabinet.includes('staffDmTopicsEnabled()') &&
    /if \(!staffDmTopicsEnabled\(\)\)/.test(cabinet) &&
    !cabinet.includes('skipInboxDb'),
);
check('единый callback Связаться ah:msg:w', dm.includes('ah:msg:w:'));
check(
  'comms: ah:msg:w + legacy admin:msg:w',
  comms.includes('admin:msg:w:') &&
    comms.includes('ah:msg:w:') &&
    read('src/lib/bot/admin/index.ts').includes('openStaffDmTopicAndNavigate'),
);
check('inbox topics: deliverInbound + ping', inbox.includes('deliverInboundToStaffTopic') && inbox.includes('notifyAdminClientContactPing'));
check('cabinet support intent из webhook', webhook.includes('notifyAdminCabinetSupportIntent') && webhook.includes('fromCabinet: true'));
check('cabinet: skipContactPing на первом сообщении', support.includes('skipContactPing') && support.includes('fromCabinet'));
check('leads: кнопка Связаться в notify', read('src/lib/bot/admin/leads.ts').includes('adminClientTopicCallback'));
check('overdue admin: ah:msg:w', read('src/lib/bot/education/homework-deadline-notify.ts').includes('ah:msg:w:'));

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
