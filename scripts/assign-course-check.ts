/**
 * @deprecated Назначайте в админ-боте: Обучение → Курс → Сотрудники курса.
 * Или Sanity: districtCourse.checkTelegramId / curatorTelegramId.
 *
 * npx tsx scripts/assign-course-check.ts -- --staff=ID --course-id=1
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAdminClient } from '../src/lib/supabase/admin';
import { addMemberExtraRole } from '../src/lib/bot/roles';
import { upsertCourseStaffAssignment } from '../src/lib/bot/education/course-staff';
import { lookupCourseIdsBySlugs } from '../src/lib/bot/education/course-record';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = raw.trim().match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
    }
  }
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const staffRaw = arg('staff');
const courseIdRaw = arg('course-id');
const courseSlug = arg('course-slug');

if (!staffRaw) {
  console.error(`Usage:
  npm run assign:course-check -- --staff=TELEGRAM_ID --course-id=ID
  npm run assign:course-check -- --staff=TELEGRAM_ID --course-slug=slug`);
  process.exit(1);
}

const staffTelegramId = Number(staffRaw);
if (!Number.isSafeInteger(staffTelegramId)) {
  console.error('Invalid --staff');
  process.exit(1);
}

async function main() {
  const admin = createAdminClient();
  let courseId = courseIdRaw != null ? Number(courseIdRaw) : NaN;

  if (!Number.isSafeInteger(courseId) || courseId <= 0) {
    const slug = courseSlug?.trim() || 'district';
    const map = await lookupCourseIdsBySlugs(admin, [slug]);
    courseId = map.get(slug) ?? NaN;
  }

  if (!Number.isSafeInteger(courseId) || courseId <= 0) {
    console.error('Course not found. Pass --course-id or --course-slug.');
    process.exit(1);
  }

  const roleOk = await addMemberExtraRole(admin, staffTelegramId, 'check');
  if (!roleOk) {
    console.error(`bot_members: нет записи для telegram_id=${staffTelegramId}`);
    process.exit(1);
  }

  await upsertCourseStaffAssignment(admin, courseId, staffTelegramId, 'check');
  console.log(
    `OK: staff ${staffTelegramId} → course ${courseId} as check (extra_roles + course_staff_assignments)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
