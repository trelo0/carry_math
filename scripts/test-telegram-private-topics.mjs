/**
 * Spike: private-chat forum topics (Threaded Mode) без webhook и без prod-логики.
 *
 *   node scripts/test-telegram-private-topics.mjs a
 *   node scripts/test-telegram-private-topics.mjs b --staff-id=123456789 --confirm-create
 *   node scripts/test-telegram-private-topics.mjs c --staff-id=123456789 --thread-id=999 --confirm-send
 *   node scripts/test-telegram-private-topics.mjs d --file=path/to/update.json
 *   node scripts/test-telegram-private-topics.mjs webhook-info
 *
 * TELEGRAM_BOT_TOKEN из .env.local (значение не выводится).
 */

import { readFileSync, existsSync } from 'node:fs';

const API = 'https://api.telegram.org';

function loadEnvLocal() {
  const env = {};
  const path = new URL('../.env.local', import.meta.url);
  if (!existsSync(path)) return env;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
  return env;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq === -1) flags[arg.slice(2)] = true;
      else flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else positional.push(arg);
  }
  return { mode: positional[0]?.toLowerCase(), flags };
}

function redactError(json) {
  if (!json || typeof json !== 'object') return String(json);
  return {
    ok: json.ok,
    error_code: json.error_code,
    description: json.description,
  };
}

async function botCall(token, method, body = {}) {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return /** @type {Promise<{ ok: boolean; result?: unknown; error_code?: number; description?: string }>} */ (
    res.json()
  );
}

function usage() {
  console.log(`Usage:
  a                          getMe (+ topics flags)
  webhook-info               getWebhookInfo (read-only)
  b --staff-id=ID --confirm-create
  c --staff-id=ID --thread-id=N --confirm-send
  d --file=path.json         parse inbound update (no network)
  d --example                print path to example JSON shape
  student-echo --student-id=ID --text="..." --confirm-student
                             sendMessage to student DM (test account only)`);
}

async function modeA(token) {
  const me = await botCall(token, 'getMe');
  console.log('=== Mode A: getMe ===');
  if (!me.ok) {
    console.log('getMe failed:', redactError(me));
    return;
  }
  const r = /** @type {Record<string, unknown>} */ (me.result);
  console.log('ok:', me.ok);
  console.log('username:', r.username ?? '(none)');
  if ('has_topics_enabled' in r) {
    console.log('has_topics_enabled:', r.has_topics_enabled);
  } else {
    console.log('has_topics_enabled: (field absent in response)');
  }
  if ('allows_users_to_create_topics' in r) {
    console.log('allows_users_to_create_topics:', r.allows_users_to_create_topics);
  }
  console.log('id:', r.id);
  console.log('can_read_all_group_messages:', r.can_read_all_group_messages ?? '(n/a)');
}

async function modeWebhookInfo(token) {
  const info = await botCall(token, 'getWebhookInfo');
  console.log('=== webhook-info (read-only) ===');
  if (!info.ok) {
    console.log('failed:', redactError(info));
    return;
  }
  const r = /** @type {Record<string, unknown>} */ (info.result);
  console.log('ok:', info.ok);
  console.log('url:', r.url ?? '(empty — polling mode)');
  console.log('pending_update_count:', r.pending_update_count);
  console.log('last_error_message:', r.last_error_message ?? '(none)');
  console.log(
    'note: при активном webhook getUpdates не доставляет updates в этот скрипт (Mode D ограничен).',
  );
}

async function modeProbeGetUpdates(token) {
  console.log('=== probe-getUpdates (read-only, one call) ===');
  const res = await botCall(token, 'getUpdates', { limit: 1, timeout: 0 });
  if (!res.ok) {
    console.log('getUpdates failed:', redactError(res));
    return;
  }
  const list = /** @type {unknown[]} */ (res.result ?? []);
  console.log('ok:', res.ok);
  console.log('updates_returned:', list.length);
  if (list.length === 0) {
    console.log('Пусто — ожидаемо при активном webhook (updates идут на URL webhook).');
  }
}

async function modeB(token, flags) {
  console.log('=== Mode B: createForumTopic ===');
  if (!flags['confirm-create']) {
    console.log('Отменено: нужен флаг --confirm-create');
    return;
  }
  const staffId = Number(flags['staff-id']);
  if (!Number.isFinite(staffId) || staffId <= 0) {
    console.log('Нужен --staff-id=<telegram user id> тестового преподавателя');
    return;
  }
  const name = flags.name?.trim() || 'TEST — District private topics';
  const res = await botCall(token, 'createForumTopic', {
    chat_id: staffId,
    name,
  });
  if (!res.ok) {
    console.log('createForumTopic failed:', redactError(res));
    return;
  }
  const topic = /** @type {Record<string, unknown>} */ (res.result);
  console.log('createForumTopic ok: true');
  console.log('message_thread_id:', topic.message_thread_id ?? '(absent)');
  console.log('name:', topic.name ?? name);
  console.log('icon_color:', topic.icon_color ?? '(n/a)');
  console.log('Сохраните message_thread_id для Mode C.');
}

async function modeC(token, flags) {
  console.log('=== Mode C: sendMessage → topic (message_thread_id) ===');
  if (!flags['confirm-send']) {
    console.log('Отменено: нужен флаг --confirm-send');
    return;
  }
  const staffId = Number(flags['staff-id']);
  const threadId = Number(flags['thread-id']);
  if (!Number.isFinite(staffId) || !Number.isFinite(threadId)) {
    console.log('Нужны --staff-id и --thread-id');
    return;
  }
  const text =
    flags.text?.trim() ||
    `[District spike ${new Date().toISOString()}] Тест темы — можно удалить тему вручную.`;
  const payload = {
    chat_id: staffId,
    message_thread_id: threadId,
    text,
  };
  const res = await botCall(token, 'sendMessage', payload);
  if (!res.ok) {
    console.log('sendMessage (message_thread_id) failed:', redactError(res));
    console.log(
      'Если ошибка "message thread not found", на Bot API 10+ может понадобиться direct_messages_topic_id — отдельный spike после подтверждения по документации.',
    );
    return;
  }
  const msg = /** @type {Record<string, unknown>} */ (res.result);
  console.log('sendMessage ok: true');
  console.log('sent message_id:', msg.message_id);
  console.log('is_topic_message:', msg.is_topic_message ?? '(absent)');
  console.log('message_thread_id in result:', msg.message_thread_id ?? '(absent)');
}

const EXAMPLE_UPDATE = new URL('./fixtures/spike-topic-reply-update.example.json', import.meta.url);

function modeD(flags) {
  console.log('=== Mode D: analyze inbound update (offline) ===');
  if (flags.example) {
    console.log('Пример структуры (подставьте значения из Vercel log / webhook body):');
    console.log(EXAMPLE_UPDATE.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    return;
  }
  const file = flags.file;
  if (!file) {
    console.log(`
Mode D без изменения webhook:
  1. Ответьте в тестовой теме в @districtschool_bot.
  2. Update уходит на Vercel webhook — скрипт его не получает.
  3. Сохраните тело POST (корень = один update) в файл, напр. update.json в корне репо.
  4. node scripts/test-telegram-private-topics.mjs d --file=update.json

Шаблон полей: node scripts/test-telegram-private-topics.mjs d --example
`);
    return;
  }
  if (!existsSync(file)) {
    console.error(`Файл не найден: ${file}`);
    console.error('Создайте update.json: скопируйте JSON update из лога webhook (см. d --example).');
    process.exit(1);
  }
  const raw = readFileSync(file, 'utf8');
  const update = JSON.parse(raw);
  const message = update.message ?? update.edited_message;
  if (!message) {
    console.log('В файле нет message / edited_message');
    return;
  }
  console.log('update_id:', update.update_id ?? '(absent)');
  console.log('from.id:', message.from?.id ?? '(absent)');
  console.log('chat.id:', message.chat?.id ?? '(absent)');
  console.log('chat.type:', message.chat?.type ?? '(absent)');
  console.log('is_topic_message:', message.is_topic_message ?? '(absent)');
  console.log('message_thread_id:', message.message_thread_id ?? '(absent)');
  console.log('direct_messages_topic:', message.direct_messages_topic ?? '(absent)');
  if (message.direct_messages_topic?.topic_id != null) {
    console.log('direct_messages_topic.topic_id:', message.direct_messages_topic.topic_id);
  }
  console.log('text preview length:', message.text?.length ?? 0);
}

async function modeStudentEcho(token, flags) {
  console.log('=== student-echo (test student only) ===');
  if (!flags['confirm-student']) {
    console.log('Отменено: нужен --confirm-student');
    return;
  }
  const studentId = Number(flags['student-id']);
  if (!Number.isFinite(studentId)) {
    console.log('Нужен --student-id= тестового аккаунта (не prod-ученик)');
    return;
  }
  const text =
    flags.text?.trim() ||
    `[District spike ${new Date().toISOString()}] echo test — не prod.`;
  const res = await botCall(token, 'sendMessage', { chat_id: studentId, text });
  if (!res.ok) {
    console.log('sendMessage to student failed:', redactError(res));
    return;
  }
  console.log('sendMessage to student ok: true');
  console.log('message_id:', /** @type {{ message_id?: number }} */ (res.result).message_id);
}

const env = loadEnvLocal();
const token = process.env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Нет TELEGRAM_BOT_TOKEN (.env.local или env)');
  process.exit(1);
}

const { mode, flags } = parseArgs(process.argv);
if (!mode) {
  usage();
  process.exit(1);
}

switch (mode) {
  case 'a':
    await modeA(token);
    break;
  case 'webhook-info':
    await modeWebhookInfo(token);
    break;
  case 'probe-getupdates':
    await modeProbeGetUpdates(token);
    break;
  case 'b':
    await modeB(token, flags);
    break;
  case 'c':
    await modeC(token, flags);
    break;
  case 'd':
    modeD(flags);
    break;
  case 'd-example':
    modeD({ example: true });
    break;
  case 'student-echo':
    await modeStudentEcho(token, flags);
    break;
  default:
    usage();
    process.exit(1);
}
