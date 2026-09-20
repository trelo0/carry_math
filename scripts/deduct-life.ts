/**
 * Снять жизнь за несданное/невыполненное ДЗ (ops).
 *
 * npm run deduct:life -- --curator=111 --student=222 --lesson=SANITY_LESSON_ID
 * npm run deduct:life -- --curator=111 --student=222 --lesson=SANITY_LESSON_ID --reason=notCompleted
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAdminClient } from '../src/lib/supabase/admin';
import {
  CourseHomeworkError,
  deductLifeForHomeworkDebtByCurator,
} from '../src/lib/bot/education/course-homework';

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
const lessonRaw = arg('lesson');
const reason = arg('reason');

if (!curatorRaw || !studentRaw || !lessonRaw) {
  console.error(`Usage:
  npm run deduct:life -- --curator=ID --student=ID --lesson=SANITY_LESSON_ID [--reason=notSubmitted|notCompleted]`);
  process.exit(1);
}

const failureKind = reason === 'notCompleted' ? 'notCompleted' : 'notSubmitted';

async function main() {
  const admin = createAdminClient();
  const curatorTelegramId = Number(curatorRaw);
  const studentTelegramId = Number(studentRaw);

  const sanityLessonId = lessonRaw!;

  try {
    const { lifeDeduction } = await deductLifeForHomeworkDebtByCurator(
      admin,
      curatorTelegramId,
      studentTelegramId,
      sanityLessonId,
      failureKind,
    );
    console.log('OK:');
    console.log(JSON.stringify(lifeDeduction, null, 2));
  } catch (error) {
    if (error instanceof CourseHomeworkError) {
      console.error(`[${error.code}] ${error.message}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
