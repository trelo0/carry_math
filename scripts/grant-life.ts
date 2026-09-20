/**
 * Восстановить жизнь ученику (ops, бонус от куратора).
 *
 * npm run grant:life -- --curator=111 --student=222 --reason="за активность"
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAdminClient } from '../src/lib/supabase/admin';
import { getDistrictCourseContent } from '../src/lib/studio/courseContent';
import { resolveCourseIdForContent } from '../src/lib/bot/education/course-record';
import { grantBonusLife } from '../src/lib/bot/education/lives';

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

const curatorRaw = arg('curator');
const studentRaw = arg('student');
const reason = arg('reason') ?? 'Бонус от куратора';

if (!curatorRaw || !studentRaw) {
  console.error(`Usage:
  npm run grant:life -- --curator=ID --student=ID [--reason=text]`);
  process.exit(1);
}

async function main() {
  const admin = createAdminClient();
  const content = await getDistrictCourseContent();
  if (!content) {
    console.error('Курс не найден в Sanity.');
    process.exit(1);
  }
  const courseId = await resolveCourseIdForContent(admin, content);
  if (!courseId) {
    console.error('course_id не найден для Sanity-курса.');
    process.exit(1);
  }

  try {
    const state = await grantBonusLife(admin, {
      telegramId: Number(studentRaw),
      courseId,
      curatorTelegramId: Number(curatorRaw),
      reason,
    });
    console.log('OK:');
    console.log(JSON.stringify(state, null, 2));
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
