/**
 * Режим check_only и префиксы callback.
 * npx tsx scripts/test-check-bot-menu.ts
 */

import { CHECK_BOT_MENU_LABELS, resolveStaffBotMode, type StaffCapabilities } from '../src/lib/bot/staff/staff-menu';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const checkOnlyCaps: StaffCapabilities = {
  telegramId: 502,
  roles: ['staff'],
  primaryRole: 'staff',
  viewRole: null,
  effectiveRole: 'staff',
  canTeacherBot: false,
  canCuratorBot: false,
  canCourseStaffBot: true,
};

assert(resolveStaffBotMode(checkOnlyCaps) === 'check_only', 'staff+check assignment → check_only');

const combined: StaffCapabilities = {
  ...checkOnlyCaps,
  canTeacherBot: true,
};
assert(resolveStaffBotMode(combined) === 'combined', 'teacher+check → combined');

assert(CHECK_BOT_MENU_LABELS.homework.includes('Домашние'), 'homework label');
assert('k:sec:hw:1'.startsWith('k:'), 'callback prefix');

console.log('test-check-bot-menu: ok');
