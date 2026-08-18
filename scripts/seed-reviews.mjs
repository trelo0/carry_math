// Одноразовый сид тестовых отзывов в Sanity (берёт токен из sanity login).
import { createClient } from '@sanity/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const cfgPath = join(homedir(), '.config', 'sanity', 'config.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const token = cfg.authToken;
if (!token) {
  console.error('Нет authToken в sanity CLI — сначала `npx sanity login`.');
  process.exit(1);
}

const client = createClient({
  projectId: '2hngrocd',
  dataset: 'production',
  token,
  apiVersion: '2024-05-01',
  useCdn: false,
});

const reviews = [
  {
    name: 'Анастасия К.',
    result: '87 баллов ЦТ',
    text: 'Я была уверена, что математика — это не моё. После трёх месяцев в Дистрикте я сдала ЦТ на 87 баллов. Геометрию объяснили так, что я сама начала решать задачи, которые раньше казались невозможными.',
  },
  {
    name: 'Дмитрий Л.',
    result: '91 балл ЦТ',
    text: 'Формат с куратором в Telegram — это огонь. Никогда не чувствовал, что остаюсь один на один с непонятным заданием. Всегда отвечали быстро и по делу.',
  },
  {
    name: 'Полина М.',
    result: '84 балла ЦТ',
    text: 'Мама сначала сомневалась в онлайн-формате. Но когда увидела мой прогресс и мои домашки с живыми комментариями куратора — она сама посоветовала школу подруге.',
  },
  {
    name: 'Артем С.',
    result: '94 балла ЦТ',
    text: 'Геймификация реально работает: карта прогресса и «боссы» вместо обычных контрольных. Сам не заметил, как начал решать часть B ради следующего уровня, а не ради оценок.',
  },
];

const existing = await client.fetch('count(*[_type == "review"])');
if (existing > 0) {
  console.log('Отзывы уже есть в Sanity:', existing, '— сид пропущен.');
  process.exit(0);
}

const docs = reviews.map((review, i) => ({
  _id: `seed-review-${i + 1}`,
  _type: 'review',
  order: i + 1,
  ...review,
}));

await client.transaction(docs.map((doc) => ({ createIfNotExists: doc }))).commit();
console.log('Засеяно отзывов:', docs.length);
