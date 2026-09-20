/**
 * Ручная сдача домашки (ops / тест до полного бота).
 *
 * npm run submit:homework -- --telegram=123 --lesson=SANITY_ID --note="ответ"
 * npm run submit:homework -- --telegram=123 --lesson=SANITY_ID --file=https://example.com/hw.pdf
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAdminClient } from '../src/lib/supabase/admin';
import { CourseHomeworkError, markHomeworkSubmitted } from '../src/lib/bot/education/course-homework';

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

const telegramRaw = arg('telegram');
const lesson = arg('lesson');
const note = arg('note');
const file = arg('file');

if (!telegramRaw || !lesson) {
  console.error(`Usage:
  npm run submit:homework -- --telegram=ID --lesson=SANITY_LESSON_ID [--note=text] [--file=https://...]`);
  process.exit(1);
}

async function main() {
  const admin = createAdminClient();
  try {
    const progress = await markHomeworkSubmitted(admin, Number(telegramRaw), lesson!, {
      note: note ?? undefined,
      fileUrl: file ?? undefined,
    });
    console.log('OK:');
    console.log(JSON.stringify(progress, null, 2));
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
