/**
 * Идемпотентная заливка достижений в cabinetAsideSettings (Sanity).
 *
 * npm run seed:cabinet-achievements
 * npm run seed:cabinet-achievements -- --dry-run
 */

import { createClient } from '@sanity/client';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const DOC_ID = 'cabinetAsideSettings';

const ACHIEVEMENTS = [
  { _key: 'a1', title: 'Старт курса', subtitle: 'Купи первый пакет занятий', ruleKey: 'course_package_purchased' },
  { _key: 'a2', title: 'На борту', subtitle: 'Запишись на программу', ruleKey: 'course_enrolled' },
  { _key: 'a3', title: 'Картограф', subtitle: 'Открой карту курса', ruleKey: 'course_map_viewed' },
  { _key: 'a4', title: 'Первый шаг', subtitle: 'Пройди первый урок', ruleKey: 'lesson_complete_1' },
  { _key: 'a5', title: 'Ритм', subtitle: 'Пройди 5 уроков', ruleKey: 'lesson_complete_5' },
  { _key: 'a6', title: 'Марафонец', subtitle: 'Пройди 10 уроков', ruleKey: 'lesson_complete_10' },
  { _key: 'a7', title: 'В эфире', subtitle: 'Посмотри первый вебинар', ruleKey: 'webinar_complete_1' },
  { _key: 'a8', title: 'Три вебинара', subtitle: 'Посмотри 3 вебинара', ruleKey: 'webinar_complete_3' },
  { _key: 'a9', title: 'ДЗ отправлено', subtitle: 'Сдай первое домашнее', ruleKey: 'hw_submitted_1' },
  { _key: 'a10', title: 'Зачёт', subtitle: 'Получи первое принятое ДЗ', ruleKey: 'hw_approved_1' },
  { _key: 'a11', title: 'Пять зачётов', subtitle: 'Пять принятых домашек', ruleKey: 'hw_approved_5' },
  { _key: 'a12', title: 'Live', subtitle: 'Попади на прямой эфир', ruleKey: 'webinar_live_1' },
  { _key: 'a13', title: 'Запись', subtitle: 'Посмотри запись урока', ruleKey: 'recording_watched_1' },
  { _key: 'a14', title: 'На связи', subtitle: 'Напиши куратору в боте', ruleKey: 'curator_message_1' },
  { _key: 'a15', title: 'Профиль', subtitle: 'Заполни класс и цель', ruleKey: 'profile_complete' },
  { _key: 'a16', title: '100+ РТ', subtitle: 'Укажи 100+ баллов в профиле', ruleKey: 'score_100' },
  { _key: 'a17', title: 'С репетитором', subtitle: 'Купи пакет индив/группы', ruleKey: 'individual_package_purchased' },
  { _key: 'a18', title: 'В расписании', subtitle: 'Запишись на занятие', ruleKey: 'group_lesson_scheduled' },
  { _key: 'a19', title: 'Оплата', subtitle: 'Первая успешная оплата', ruleKey: 'payment_success_1' },
];

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(resolve(process.cwd(), '.env.local'));
loadEnvFile(resolve(process.cwd(), '.env'));

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '2hngrocd';
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production';
const token = process.env.SANITY_API_WRITE_TOKEN;

if (!token) {
  console.error('SANITY_API_WRITE_TOKEN не задан (.env.local)');
  process.exit(1);
}

const client = createClient({
  projectId,
  dataset,
  token,
  apiVersion: '2024-01-01',
  useCdn: false,
});

const existing = await client.fetch(`*[_id == $id][0]{ _id, achievements }`, { id: DOC_ID });

const patch = {
  _id: DOC_ID,
  _type: 'cabinetAsideSettings',
  achievements: ACHIEVEMENTS,
};

if (dryRun) {
  console.log('[dry-run] would upsert achievements:', ACHIEVEMENTS.length);
  console.log(JSON.stringify(patch, null, 2));
  process.exit(0);
}

if (existing?._id) {
  await client.patch(DOC_ID).set({ achievements: ACHIEVEMENTS }).commit();
  console.log(`Updated ${DOC_ID}: ${ACHIEVEMENTS.length} achievements`);
} else {
  await client.createOrReplace(patch);
  console.log(`Created ${DOC_ID}: ${ACHIEVEMENTS.length} achievements`);
}
