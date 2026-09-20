/**
 * Ручное назначение ind/group занятия (до бота).
 *
 * npm run schedule:lesson -- --telegram=123 --kind=individual --at=2026-09-25T18:30:00+03:00 --topic="Квадратные уравнения" --meet=https://meet.google.com/xxx
 * npm run schedule:lesson -- --phone=+375... --kind=group --at=... --topic="..." --material="Презентация.pdf|https://example.com/a.pdf|2.1 MB"
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAdminClient } from '../src/lib/supabase/admin';
import {
  LessonScheduleError,
  scheduleStudentLesson,
  scheduleStudentLessonByPhone,
  type ScheduleHomeworkInput,
  type ScheduleMaterialInput,
  type ScheduleStudentLessonInput,
} from '../src/lib/bot/lesson-scheduling';

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

function args(name: string): string[] {
  const prefix = `--${name}=`;
  return process.argv.filter((a) => a.startsWith(prefix)).map((a) => a.slice(prefix.length));
}

function parsePipeValue(raw: string, label: string): { name: string; url: string; size?: string } {
  const parts = raw.split('|');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    console.error(`${label}: формат «название|url|размер?»`);
    process.exit(1);
  }
  return { name: parts[0], url: parts[1], size: parts[2] };
}

const telegramRaw = arg('telegram');
const phone = arg('phone');
const kindRaw = arg('kind');
const startsAt = arg('at');
const topic = arg('topic');
const packageRaw = arg('package');
const meetUrl = arg('meet');
const teacherRaw = arg('teacherTelegram');
const groupRaw = arg('group');
const durationRaw = arg('duration');

if (
  (kindRaw !== 'individual' && kindRaw !== 'group') ||
  !startsAt ||
  !topic ||
  (!telegramRaw && !phone)
) {
  console.error(`Usage:
  npm run schedule:lesson -- --telegram=ID --kind=individual|group --at=ISO_DATE --topic="..." [--package=ID] [--meet=URL] [--material="name|url|size"] [--homework="name|url|size"]
  npm run schedule:lesson -- --phone=+375... --kind=... --at=... --topic=...`);
  process.exit(1);
}

const materials: ScheduleMaterialInput[] = args('material').map((raw) => parsePipeValue(raw, '--material'));
const homeworkRaw = arg('homework');
const homework: ScheduleHomeworkInput | undefined = homeworkRaw
  ? parsePipeValue(homeworkRaw, '--homework')
  : undefined;

const input: ScheduleStudentLessonInput = {
  kind: kindRaw,
  startsAt,
  topic,
  packageId: packageRaw != null ? Number(packageRaw) : undefined,
  meetUrl,
  teacherTelegramId: teacherRaw != null ? Number(teacherRaw) : undefined,
  groupId: groupRaw != null ? Number(groupRaw) : undefined,
  durationMinutes: durationRaw != null ? Number(durationRaw) : undefined,
  materials: materials.length ? materials : undefined,
  homework,
};

async function main() {
  const admin = createAdminClient();
  try {
    const result = telegramRaw
      ? await scheduleStudentLesson(admin, Number(telegramRaw), input)
      : await scheduleStudentLessonByPhone(admin, phone!, input);

    console.log('OK:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof LessonScheduleError) {
      console.error(`[${error.code}] ${error.message}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
