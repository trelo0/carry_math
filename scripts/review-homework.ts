/**
 * Ручная проверка домашки куратором (ops).
 *
 * npm run review:homework -- --curator=111 --student=222 --lesson=3 --action=approve
 * npm run review:homework -- --curator=111 --student=222 --lesson=3 --action=reject --note="переделай"
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAdminClient } from '../src/lib/supabase/admin';
import {
  approveCourseHomeworkByCurator,
  CourseHomeworkError,
  rejectCourseHomeworkByCurator,
} from '../src/lib/bot/education/course-homework';
import { notifyStudentHomeworkReviewed } from '../src/lib/bot/studentHomeworkFlow';

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
const action = arg('action');
const note = arg('note');

if (!curatorRaw || !studentRaw || !lessonRaw || (action !== 'approve' && action !== 'reject')) {
  console.error(`Usage:
  npm run review:homework -- --curator=ID --student=ID --lesson=NUMBER --action=approve|reject [--note=text]`);
  process.exit(1);
}

async function main() {
  const admin = createAdminClient();
  const curatorTelegramId = Number(curatorRaw);
  const studentTelegramId = Number(studentRaw);
  const lessonNumber = Number(lessonRaw);

  try {
    const result =
      action === 'approve'
        ? await approveCourseHomeworkByCurator(admin, curatorTelegramId, studentTelegramId, lessonNumber)
        : await rejectCourseHomeworkByCurator(
            admin,
            curatorTelegramId,
            studentTelegramId,
            lessonNumber,
            note,
          );

    await notifyStudentHomeworkReviewed(admin, studentTelegramId, {
      lessonNumber: result.lesson.lessonNumber,
      title: result.lesson.title,
      approved: action === 'approve',
      note,
    });

    console.log('OK:');
    console.log(JSON.stringify(result.progress, null, 2));
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
