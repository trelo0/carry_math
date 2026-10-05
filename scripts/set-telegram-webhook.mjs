/**
 * Регистрация Telegram webhook на нужный хост.
 *
 *   node scripts/set-telegram-webhook.mjs vercel   — временно district-school.vercel.app
 *   node scripts/set-telegram-webhook.mjs by       — прод district-school.by
 *   node scripts/set-telegram-webhook.mjs https://example.com
 *
 * Берёт TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET из .env.local
 */

import { readFileSync } from 'node:fs';

const PRESETS = {
  vercel: 'https://district-school.vercel.app',
  by: 'https://district-school.by',
};

const env = {};
for (const raw of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
}

const token = env.TELEGRAM_BOT_TOKEN;
const secret = env.TELEGRAM_WEBHOOK_SECRET;
if (!token) {
  console.error('Нет TELEGRAM_BOT_TOKEN в .env.local');
  process.exit(1);
}

const arg = (process.argv[2] ?? 'vercel').trim();
let base = PRESETS[arg] ?? arg;
if (!base.startsWith('http')) {
  console.error('Использование: node scripts/set-telegram-webhook.mjs vercel|by|<base-url>');
  process.exit(1);
}
base = base.replace(/\/$/, '');
const webhookUrl = `${base}/api/telegram/webhook`;

const payload = {
  url: webhookUrl,
  allowed_updates: ['message', 'callback_query'],
};
if (secret) payload.secret_token = secret;

const setRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const setJson = await setRes.json();
if (!setJson.ok) {
  console.error('setWebhook failed:', setJson.description ?? setJson);
  process.exit(1);
}

const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
const info = await infoRes.json();
console.log('OK webhook →', webhookUrl);
if (info.ok && info.result) {
  const r = info.result;
  console.log('getWebhookInfo:');
  console.log('  url:', r.url);
  console.log('  pending_update_count:', r.pending_update_count);
  if (r.last_error_message) console.log('  last_error_message:', r.last_error_message);
  else console.log('  last_error_message: (none)');
}
