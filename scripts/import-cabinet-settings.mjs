/**
 * Идемпотентный импорт настроек кабинета (цены пакетов) в Sanity.
 *
 * Запуск:
 *   npm run import:cabinet-settings
 *   npm run import:cabinet-settings -- --dry-run
 */

import { createClient } from '@sanity/client';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const DOC_ID = 'cabinetSettings';

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

const doc = {
  _id: DOC_ID,
  _type: 'cabinetSettings',
  teachers: [
    { _key: 'kristina', teacherId: 'kristina', name: 'Кристина Денисовна' },
    { _key: 'anna', teacherId: 'anna', name: 'Анна Сергеевна' },
  ],
  courseOffer: {
    description: 'Полный доступ к программе подготовки к ЦТ',
    priceByn: 120,
  },
  individualPackages: [
    {
      _key: 'ind1',
      name: '1 занятие',
      prices: [
        { _key: 'k1', teacherId: 'kristina', priceByn: 25 },
        { _key: 'a1', teacherId: 'anna', priceByn: 22 },
      ],
    },
    {
      _key: 'ind4',
      name: '4 занятия',
      savingsChip: 'Экономия 10 BYN',
      prices: [
        { _key: 'k4', teacherId: 'kristina', priceByn: 90 },
        { _key: 'a4', teacherId: 'anna', priceByn: 80 },
      ],
    },
    {
      _key: 'ind10',
      name: '10 занятий',
      savingsChip: 'Экономия 50 BYN',
      prices: [
        { _key: 'k10', teacherId: 'kristina', priceByn: 200 },
        { _key: 'a10', teacherId: 'anna', priceByn: 180 },
      ],
    },
  ],
  groupPackages: [
    {
      _key: 'grp1',
      name: '1 занятие',
      prices: [
        { _key: 'gk1', teacherId: 'kristina', priceByn: 15 },
        { _key: 'ga1', teacherId: 'anna', priceByn: 13 },
      ],
    },
    {
      _key: 'grp4',
      name: '4 занятия',
      savingsChip: 'Экономия 15 BYN',
      prices: [
        { _key: 'gk4', teacherId: 'kristina', priceByn: 45 },
        { _key: 'ga4', teacherId: 'anna', priceByn: 40 },
      ],
    },
    {
      _key: 'grp8',
      name: '8 занятий',
      savingsChip: 'Экономия 40 BYN',
      prices: [
        { _key: 'gk8', teacherId: 'kristina', priceByn: 80 },
        { _key: 'ga8', teacherId: 'anna', priceByn: 70 },
      ],
    },
  ],
};

async function main() {
  if (dryRun) {
    console.log('[dry-run] cabinetSettings:', JSON.stringify(doc, null, 2));
    return;
  }
  await client.createOrReplace(doc);
  console.log(`OK: ${DOC_ID} импортирован в ${projectId}/${dataset}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
