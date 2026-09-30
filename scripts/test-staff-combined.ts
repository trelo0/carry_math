/**
 * npx tsx scripts/test-staff-combined.ts
 */
import {
  COMBINED_STAFF_MENU_LABELS,
  resolveStaffBotMode,
  staffReplyKeyboard,
  type StaffCapabilities,
} from '@/lib/bot/staff/staff-menu';
import {
  renderCombinedHomeworkHub,
  renderCombinedMessagesHub,
  renderCombinedStudentsHub,
} from '@/lib/bot/staff/staff-combined-screens';

let ok = 0;
let fail = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    ok++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`);
  }
}

const combinedCaps: StaffCapabilities = {
  telegramId: 1,
  roles: ['teacher', 'curator'],
  primaryRole: 'teacher',
  viewRole: null,
  effectiveRole: 'teacher',
  canTeacherBot: true,
  canCuratorBot: true,
};

console.log('Тест 1: mode combined');
check('mode', resolveStaffBotMode(combinedCaps) === 'combined');

console.log('Тест 2: клавиатура 6 пунктов + cabinet');
{
  const kb = staffReplyKeyboard(combinedCaps);
  const labels = (kb.keyboard ?? []).flat().map((b) => b.text);
  check('6 labels', labels.length === 6);
  check('course', labels.includes(COMBINED_STAFF_MENU_LABELS.course));
  check('cabinet last', labels[labels.length - 1] === COMBINED_STAFF_MENU_LABELS.cabinet);
}

console.log('Тест 3: hubs s:* callbacks');
{
  const st = JSON.stringify(renderCombinedStudentsHub(null).keyboard);
  const hw = JSON.stringify(renderCombinedHomeworkHub(null).keyboard);
  const msg = JSON.stringify(renderCombinedMessagesHub(null).keyboard);
  check('students', st.includes('s:stu:c') && st.includes('s:stu:i'));
  check('homework', hw.includes('s:hw:t') && hw.includes('s:hw:c'));
  check('messages', msg.includes('s:msg:t') && msg.includes('s:msg:c'));
}

console.log(`\nИтого: ${ok} ok, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
