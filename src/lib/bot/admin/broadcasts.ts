import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  type AdminMessage,
  type AdminPayload,
  type BroadcastAttachmentKind,
  type ConversationState,
  type Deliver,
  type IncomingDocument,
  type InlineButton,
  type InlineKeyboard,
  clearState,
  clearStateIfAvailable,
  editAdminMessage,
  editDeliver,
  getState,
  homeButton,
  homeOnlyKeyboard,
  isConversationStateTableError,
  isValidHttpUrl,
  migrationText,
  saveState,
  sendAdminMessage,
  sendDeliver,
  shorten,
  showAdminHome,
} from './core';

// ---------------------------------------------------------------------------
// Массовая рассылка
// ---------------------------------------------------------------------------

// Аудитории рассылки строятся по существующим данным bot_members.
// «Платные» определяются ролью student («купил курс»): отдельной таблицы
// оплат в проекте пока нет — категория станет точнее, когда она появится.
type BroadcastAudience = {
  id: string;
  buttonLabel: string;
  title: string;
  roles: string[];
};

const BROADCAST_AUDIENCES: BroadcastAudience[] = [
  { id: 'all', buttonLabel: '👥 Все пользователи', title: 'Все пользователи', roles: ['guest', 'student', 'curator', 'teacher', 'mentor', 'admin', 'test'] },
  { id: 'guest', buttonLabel: '❄️ Гости', title: 'Гости', roles: ['guest'] },
  { id: 'paid', buttonLabel: '💳 Платные пользователи', title: 'Платные пользователи', roles: ['student'] },
  { id: 'student', buttonLabel: '🎓 Ученики', title: 'Ученики', roles: ['student'] },
  { id: 'curator', buttonLabel: '🟡 Кураторы', title: 'Кураторы / менторы', roles: ['curator', 'mentor'] },
  { id: 'teacher', buttonLabel: '🟠 Преподаватели', title: 'Преподаватели', roles: ['teacher'] },
];

// Фиксированная аудитория сценария «Отправить администраторам»:
// в меню выбора не показывается, задаётся автоматически.
const BROADCAST_ADMINS_AUDIENCE: BroadcastAudience = {
  id: 'admin',
  buttonLabel: '',
  title: 'Администраторы',
  roles: ['admin'],
};

// 4096 — лимит текста sendMessage, 1024 — лимит подписи к вложению.
const BROADCAST_TEXT_LIMIT = 4096;
const BROADCAST_CAPTION_LIMIT = 1024;
// ~20 сообщений/с: с запасом под лимит Bot API ~30 сообщ/с на бота.
const BROADCAST_DELAY_MS = 50;
// Пагинация Supabase: больше 1000 строк за запрос получить нельзя.
const BROADCAST_FETCH_PAGE = 1000;
// Ошибки храним ограниченно, чтобы не раздувать память и jsonb-строку.
const BROADCAST_ERROR_CAP = 500;
// Пагинация экранов истории и ошибок.
const BROADCAST_HISTORY_PER_PAGE = 5;
const BROADCAST_ERRORS_PER_PAGE = 10;

function findBroadcastAudience(id: string | undefined): BroadcastAudience | undefined {
  if (!id) return undefined;
  if (id === BROADCAST_ADMINS_AUDIENCE.id) return BROADCAST_ADMINS_AUDIENCE;
  return BROADCAST_AUDIENCES.find((audience) => audience.id === id);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type BroadcastError = { name: string; reason: string };

// Получатели рассылки: участники выбранных ролей с подключённым Telegram.
async function getBroadcastRecipients(admin: SupabaseClient, roles: string[]): Promise<number[]> {
  const chatIds: number[] = [];
  for (let page = 0; ; page += 1) {
    const from = page * BROADCAST_FETCH_PAGE;
    const { data, error } = await admin
      .from('bot_members')
      .select('chat_id')
      .in('role', roles)
      .not('chat_id', 'is', null)
      .range(from, from + BROADCAST_FETCH_PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.chat_id) chatIds.push(row.chat_id);
    }
    if ((data ?? []).length < BROADCAST_FETCH_PAGE) break;
  }
  return chatIds;
}

// ---------------------------------------------------------------------------
// История рассылок (bot_broadcasts): статистика и ошибки привязаны к id
// ---------------------------------------------------------------------------

type BroadcastRecord = {
  id: number;
  created_at: string;
  admin_telegram_id: number;
  audience_id: string;
  audience_title: string;
  to_admins: boolean;
  text_preview: string;
  has_attachment: boolean;
  has_button: boolean;
  recipients: number;
  delivered: number;
  failed: number;
  errors: BroadcastError[];
};

// 42P01 — таблицы нет, PGRST205 — PostgREST ещё не подхватил схему.
// Только эти случаи считаются «миграция не применена»: любые другие ошибки
// с упоминанием таблицы (например, not-null violation) пробрасываются дальше.
export function isBroadcastTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return message.includes('bot_broadcasts') && (
    message.includes('does not exist') || message.includes('Could not find')
  );
}

export type BroadcastHistoryRow = Pick<
  BroadcastRecord,
  'id' | 'created_at' | 'audience_title' | 'to_admins' | 'recipients' | 'delivered' | 'failed'
>;

// Возвращает id сохранённой рассылки либо null, если миграция не применена.
async function saveBroadcastRecord(
  admin: SupabaseClient,
  row: Omit<BroadcastRecord, 'id' | 'created_at'>,
): Promise<number | null> {
  const { data, error } = await admin.from('bot_broadcasts').insert(row).select('id').single();
  if (error) {
    if (isBroadcastTableError(error)) {
      console.error('Таблица истории рассылок не применена (supabase/bot_broadcasts.sql):', error);
      return null;
    }
    throw error;
  }
  return (data as { id: number } | null)?.id ?? null;
}

export async function listBroadcastHistory(
  admin: SupabaseClient,
  page: number,
): Promise<{ rows: BroadcastHistoryRow[]; total: number }> {
  const from = page * BROADCAST_HISTORY_PER_PAGE;
  const { data, error, count } = await admin
    .from('bot_broadcasts')
    .select('id, created_at, audience_title, to_admins, recipients, delivered, failed', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + BROADCAST_HISTORY_PER_PAGE - 1);
  if (error) throw error;
  return { rows: (data ?? []) as BroadcastHistoryRow[], total: count ?? 0 };
}

async function getBroadcastRecord(admin: SupabaseClient, id: number): Promise<BroadcastRecord | null> {
  const { data, error } = await admin.from('bot_broadcasts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Omit<BroadcastRecord, 'errors'> & { errors?: unknown };
  return { ...row, errors: Array.isArray(row.errors) ? (row.errors as BroadcastError[]) : [] };
}

// Сводная статистика по всей истории (агрегируем на сервере, строк немного).
export async function summarizeBroadcastHistory(
  admin: SupabaseClient,
): Promise<{ mailings: number; messages: number; delivered: number; failed: number; toUsers: number; toAdmins: number }> {
  let rows: BroadcastHistoryRow[] = [];
  for (let page = 0; ; page += 1) {
    const from = page * BROADCAST_FETCH_PAGE;
    const { data, error } = await admin
      .from('bot_broadcasts')
      .select('id, created_at, audience_title, to_admins, recipients, delivered, failed')
      .range(from, from + BROADCAST_FETCH_PAGE - 1);
    if (error) throw error;
    rows = rows.concat((data ?? []) as BroadcastHistoryRow[]);
    if ((data ?? []).length < BROADCAST_FETCH_PAGE) break;
  }

  return {
    mailings: rows.length,
    messages: rows.reduce((sum, row) => sum + row.recipients, 0),
    delivered: rows.reduce((sum, row) => sum + row.delivered, 0),
    failed: rows.reduce((sum, row) => sum + row.failed, 0),
    toUsers: rows.filter((row) => !row.to_admins).length,
    toAdmins: rows.filter((row) => row.to_admins).length,
  };
}

export function formatBroadcastDate(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'дата неизвестна';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(date);
}

async function renderBroadcastMigrationMessage(message: AdminMessage): Promise<void> {
  await editAdminMessage(message, migrationText('bot_broadcasts.sql'), homeOnlyKeyboard());
}

// Главное меню раздела «Рассылки».
// Меню раздела: из Reply Keyboard приходит новым сообщением,
// из inline-навигации — редактирует текущий блок.
export async function renderBroadcastMenu(deliver: Deliver): Promise<void> {
  await deliver('📢 Рассылки', {
    inline_keyboard: [
      [{ text: '✉️ Новая рассылка', callback_data: 'admin:bc:new' }],
      [{ text: '👥 Отправить администраторам', callback_data: 'admin:bc:admins' }],
      [{ text: '📊 Статистика рассылок', callback_data: 'admin:bc:statsmenu' }],
      [homeButton()],
    ],
  });
}

async function renderBroadcastAudienceMenu(message: AdminMessage): Promise<void> {
  const keyboard: InlineButton[][] = BROADCAST_AUDIENCES.map((audience) => [
    { text: audience.buttonLabel, callback_data: `admin:bc:aud:${audience.id}` },
  ]);
  keyboard.push([{ text: '⬅️ Назад', callback_data: 'admin:broadcasts' }], [homeButton()]);
  await editAdminMessage(
    message,
    '📢 Массовая рассылка\n\nВыберите аудиторию:',
    { inline_keyboard: keyboard },
  );
}

async function startBroadcastText(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  audience: BroadcastAudience,
): Promise<void> {
  await saveState(admin, telegramId, message, 'broadcast:text', {
    audience: audience.id,
  });
  await editAdminMessage(
    message,
    `📢 Новая рассылка\n\nАудитория: ${audience.title}\n\nВведите текст сообщения следующим сообщением.`,
    {
      inline_keyboard: [
        [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
        [homeButton()],
      ],
    },
  );
}

function attachmentLine(payload: AdminPayload): string | null {
  if (!payload.fileId || !payload.attachmentKind) return null;
  const icon = payload.attachmentKind === 'photo' ? '🖼' : '📎';
  return payload.fileName ? `${icon} ${payload.fileName}` : `${icon} вложение`;
}

function buttonLine(payload: AdminPayload): string | null {
  return payload.buttonText && payload.buttonUrl ? `🔗 Кнопка: ${payload.buttonText}` : null;
}

// Конструктор рассылки: после текстового/файлового ввода — новое сообщение,
// при навигации кнопками — редактирование текущего блока.
async function renderBroadcastComposer(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  deliver: Deliver,
  notice = '',
): Promise<void> {
  const payload = state.payload ?? {};
  const audience = findBroadcastAudience(payload.audience);
  if (!audience || !payload.broadcastText) {
    await clearState(admin, telegramId);
    await deliver('Черновик рассылки не найден. Начните заново.', {
      inline_keyboard: [[{ text: '📢 К рассылкам', callback_data: 'admin:broadcasts' }]],
    });
    return;
  }

  const lines = [
    ...(notice ? [notice, ''] : []),
    '📢 Новая рассылка',
    `Аудитория: ${audience.title}`,
    '',
    `Текст: ${shorten(payload.broadcastText.replace(/\n/g, ' '), 120)}`,
  ];
  const attachment = attachmentLine(payload);
  if (attachment) lines.push(attachment);
  const button = buttonLine(payload);
  if (button) lines.push(button);
  lines.push('', 'Можно прикрепить файл, добавить кнопку-ссылку или сразу перейти к предпросмотру.');

  const messageId = await deliver(lines.join('\n'), {
    inline_keyboard: [
      [{ text: '📎 Прикрепить файл / фото', callback_data: 'admin:bc:attach' }],
      [{ text: '🔗 Добавить кнопку', callback_data: 'admin:bc:button' }],
      [{ text: '👁 Предпросмотр', callback_data: 'admin:bc:preview' }],
      [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
    ],
  });
  await saveState(
    admin,
    telegramId,
    { chatId: state.chat_id, messageId: messageId ?? state.message_id },
    'broadcast:compose',
    payload,
  );
}

async function renderBroadcastAttachPrompt(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
): Promise<void> {
  const payload = state.payload ?? {};
  if (payload.attachmentKind && payload.fileId) {
    await renderBroadcastComposer(admin, telegramId, state, editDeliver({ chatId: state.chat_id, messageId: state.message_id }));
    return;
  }
  await saveState(admin, telegramId, { chatId: state.chat_id, messageId: state.message_id }, 'broadcast:compose', payload);
  await editAdminMessage(
    { chatId: state.chat_id, messageId: state.message_id },
    '📎 Отправьте вложение следующим сообщением: PDF, документ или изображение.\n\n' +
      'Бот получит file_id автоматически — вводить его вручную не нужно.',
    {
      inline_keyboard: [
        [{ text: '↩️ Назад', callback_data: 'admin:bc:menu' }],
        [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
      ],
    },
  );
}

export async function handleBroadcastAttachment(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  document: IncomingDocument,
): Promise<boolean> {
  const payload = state.payload ?? {};
  const kind: BroadcastAttachmentKind = document.kind === 'photo' ? 'photo' : 'document';

  // Лимит подписи у сообщений с вложением строже, чем у обычного текста.
  if ((payload.broadcastText ?? '').length > BROADCAST_CAPTION_LIMIT) {
    await sendAdminMessage(
      state.chat_id,
      `⚠️ Текст слишком длинный для сообщения с вложением (максимум ${BROADCAST_CAPTION_LIMIT} символов). Сократите текст и прикрепите файл ещё раз.`,
      {
        inline_keyboard: [
          [{ text: '✏️ Изменить текст', callback_data: 'admin:bc:text' }],
          [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
        ],
      },
    );
    return true;
  }

  // Файл — ввод админа: конструктор показываем новым сообщением.
  await renderBroadcastComposer(
    admin,
    telegramId,
    {
      ...state,
      step: 'broadcast:compose',
      payload: { ...payload, attachmentKind: kind, fileId: document.fileId, fileName: document.fileName },
    },
    sendDeliver(state.chat_id),
    `📎 Файл получен${document.fileName ? `: ${document.fileName}` : ''}.\nСтатус: ✅ Сохранён`,
  );
  return true;
}

async function renderBroadcastButtonText(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
): Promise<void> {
  const message = { chatId: state.chat_id, messageId: state.message_id };
  await saveState(admin, telegramId, message, 'broadcast:button-text', state.payload ?? {});
  await editAdminMessage(message, '🔗 Введите текст кнопки следующим сообщением.\n\nНапример: «Открыть вебинар».', {
    inline_keyboard: [
      [{ text: '↩️ Назад', callback_data: 'admin:bc:menu' }],
      [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
    ],
  });
}

function broadcastUrlKeyboard(payload: AdminPayload): InlineKeyboard | undefined {
  if (!payload.buttonText || !payload.buttonUrl) return undefined;
  return { inline_keyboard: [[{ text: payload.buttonText, url: payload.buttonUrl }]] };
}

async function renderBroadcastPreview(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
): Promise<void> {
  const payload = state.payload ?? {};
  const audience = findBroadcastAudience(payload.audience);
  const message = { chatId: state.chat_id, messageId: state.message_id };
  if (!audience || !payload.broadcastText) {
    await clearState(admin, telegramId);
    await renderBroadcastAudienceMenu(message);
    return;
  }

  // Предпросмотр максимально близок к реальному сообщению: файл/фото
  // отправляются админу отдельным сообщением, как увидят получатели.
  const urlKeyboard = broadcastUrlKeyboard(payload);
  if (payload.fileId && payload.attachmentKind) {
    const method = payload.attachmentKind === 'photo' ? 'sendPhoto' : 'sendDocument';
    const body: Record<string, unknown> = {
      chat_id: state.chat_id,
      [payload.attachmentKind === 'photo' ? 'photo' : 'document']: payload.fileId,
      caption: payload.broadcastText,
    };
    if (urlKeyboard) body.reply_markup = urlKeyboard;
    await telegramSend(method, body);
  } else {
    const body: Record<string, unknown> = { chat_id: state.chat_id, text: payload.broadcastText };
    if (urlKeyboard) body.reply_markup = urlKeyboard;
    await telegramSend('sendMessage', body);
  }

  const recipients = await getBroadcastRecipients(admin, audience.roles);
  await saveState(admin, telegramId, message, 'broadcast:preview', payload);

  const attachment = attachmentLine(payload);
  const button = buttonLine(payload);
  const lines = [
    '📢 Предпросмотр отправлен выше — так сообщение увидят получатели.',
    '',
    shorten(payload.broadcastText, 300),
  ];
  if (attachment) lines.push(attachment);
  if (button) lines.push(button);
  lines.push('', `👥 Получателей: ${recipients.length}`);

  await editAdminMessage(message, lines.join('\n'), {
    inline_keyboard: [
      [{ text: '✅ Отправить', callback_data: 'admin:bc:confirm' }],
      [{ text: '✏️ Изменить', callback_data: 'admin:bc:menu' }],
      [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
    ],
  });
}

async function renderBroadcastConfirm(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
): Promise<void> {
  const payload = state.payload ?? {};
  const audience = findBroadcastAudience(payload.audience);
  const message = { chatId: state.chat_id, messageId: state.message_id };
  if (!audience || !payload.broadcastText) {
    await clearState(admin, telegramId);
    await renderBroadcastAudienceMenu(message);
    return;
  }

  const recipients = await getBroadcastRecipients(admin, audience.roles);
  if (recipients.length === 0) {
    await editAdminMessage(
      message,
      `⚠️ В аудитории «${audience.title}» нет пользователей с подключённым Telegram. Рассылка невозможна.`,
      {
        inline_keyboard: [
          [{ text: '✏️ Изменить', callback_data: 'admin:bc:menu' }],
          [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
        ],
      },
    );
    return;
  }

  await saveState(admin, telegramId, message, 'broadcast:confirm', payload);
  await editAdminMessage(
    message,
    '📢 Вы собираетесь отправить сообщение:\n\n' +
      `Аудитория: ${audience.title}\n` +
      `Получателей: ${recipients.length}`,
    {
      inline_keyboard: [
        [{ text: '✅ Да, отправить', callback_data: 'admin:bc:send' }],
        [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
      ],
    },
  );
}

// Отправляет одно сообщение рассылки: при 429 ждём retry_after и повторяем.
async function sendBroadcastMessage(chatId: number, payload: AdminPayload): Promise<{ ok: boolean; reason?: string }> {
  const urlKeyboard = broadcastUrlKeyboard(payload);
  const attempts: Array<Record<string, unknown>> = [];
  if (payload.fileId && payload.attachmentKind) {
    attempts.push({
      method: payload.attachmentKind === 'photo' ? 'sendPhoto' : 'sendDocument',
      body: {
        chat_id: chatId,
        [payload.attachmentKind === 'photo' ? 'photo' : 'document']: payload.fileId,
        caption: payload.broadcastText,
        ...(urlKeyboard ? { reply_markup: urlKeyboard } : {}),
      },
    });
  } else {
    attempts.push({
      method: 'sendMessage',
      body: { chat_id: chatId, text: payload.broadcastText, ...(urlKeyboard ? { reply_markup: urlKeyboard } : {}) },
    });
  }

  for (let attempt = 0; attempt < attempts.length; attempt += 1) {
    const current = attempts[attempt];
    const result = await telegramSend(current.method as string, current.body as Record<string, unknown>);
    if (result.ok) return { ok: true };

    const description = result.description ?? '';
    // 429 — общий лимит Bot API: ждём и повторяем тот же вызов.
    if (description.includes('Too Many Requests')) {
      const retryAfter = result.parameters?.retry_after ?? 3;
      await delay(retryAfter * 1000);
      attempts.push(current);
      continue;
    }
    if (description.includes('bot was blocked')) return { ok: false, reason: 'заблокировал бота' };
    if (
      description.includes('chat not found') ||
      description.includes('user is deactivated') ||
      description.includes('PEER_ID_INVALID')
    ) {
      return { ok: false, reason: 'недействительный chat_id' };
    }
    return { ok: false, reason: description };
  }
  return { ok: false, reason: 'превышено число попыток (429)' };
}

async function executeBroadcast(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
): Promise<void> {
  const payload = state.payload ?? {};
  const audience = findBroadcastAudience(payload.audience);
  const message = { chatId: state.chat_id, messageId: state.message_id };
  if (!audience || !payload.broadcastText) {
    await clearState(admin, telegramId);
    await renderBroadcastAudienceMenu(message);
    return;
  }

  const recipients = await getBroadcastRecipients(admin, audience.roles);
  await editAdminMessage(
    message,
    `📢 Отправляем рассылку: получателей ${recipients.length}. Это может занять время — не закрывайте чат.`,
    homeOnlyKeyboard(),
  );

  let delivered = 0;
  let failed = 0;
  const errors: BroadcastError[] = [];

  // Ошибка на одном получателе не останавливает всю рассылку.
  for (const chatId of recipients) {
    let result: { ok: boolean; reason?: string } = { ok: false, reason: 'сбой отправки' };
    try {
      result = await sendBroadcastMessage(chatId, payload);
    } catch (error) {
      result = { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    if (result.ok) {
      delivered += 1;
    } else {
      failed += 1;
      if (errors.length < BROADCAST_ERROR_CAP) {
        errors.push({ name: `chat ${chatId}`, reason: result.reason ?? 'неизвестная ошибка' });
      }
    }
    await delay(BROADCAST_DELAY_MS);
  }

  const statsLine =
    `👥 Получателей: ${recipients.length}\n✅ Доставлено: ${delivered}\n❌ Не доставлено: ${failed}`;
  // История и ошибки сохраняются в bot_broadcasts и привязаны к id рассылки.
  const broadcastId = await saveBroadcastRecord(admin, {
    admin_telegram_id: telegramId,
    audience_id: audience.id,
    audience_title: audience.title,
    to_admins: audience.id === BROADCAST_ADMINS_AUDIENCE.id,
    text_preview: shorten(payload.broadcastText.replace(/\n/g, ' '), 160),
    has_attachment: Boolean(payload.fileId),
    has_button: Boolean(payload.buttonText && payload.buttonUrl),
    recipients: recipients.length,
    delivered,
    failed,
    errors: errors.slice(0, BROADCAST_ERROR_CAP),
  });

  // Сценарий завершён: состояние очищаем, история уже в базе.
  await clearStateIfAvailable(admin, telegramId);

  if (broadcastId === null) {
    // Без миграции истории показываем хотя бы итоги отправки.
    await editAdminMessage(
      message,
      `📢 Рассылка завершена\n\n${statsLine}\n\n${migrationText('bot_broadcasts.sql')}`,
      homeOnlyKeyboard(),
    );
    return;
  }

  await renderBroadcastResult(message, broadcastId, statsLine, errors.length > 0);

  if (errors.length > 0) {
    console.error(`Ошибки рассылки #${broadcastId}:`, errors.slice(0, 20));
  }
}

// Итог только что завершённой рассылки: кнопка ошибок ведёт на её id.
async function renderBroadcastResult(
  message: AdminMessage,
  broadcastId: number,
  statsLine: string,
  hasErrors: boolean,
): Promise<void> {
  const keyboard: InlineButton[][] = [];
  if (hasErrors) {
    keyboard.push([{ text: '📋 Ошибки', callback_data: `admin:bc:err:${broadcastId}:0` }]);
  }
  keyboard.push([homeButton()]);
  await editAdminMessage(message, `📢 Рассылка завершена\n\n${statsLine}`, { inline_keyboard: keyboard });
}

// Сводная статистика по всей истории рассылок.
async function renderBroadcastSummary(admin: SupabaseClient, message: AdminMessage): Promise<void> {
  try {
    const summary = await summarizeBroadcastHistory(admin);
    const deliveryRate =
      summary.messages > 0 ? `${((summary.delivered / summary.messages) * 100).toFixed(1)}%` : '—';
    const text = [
      '📊 Статистика рассылок',
      '',
      `Всего рассылок: ${summary.mailings}`,
      '',
      `📨 Всего сообщений: ${summary.messages}`,
      `✅ Доставлено: ${summary.delivered}`,
      `❌ Ошибок: ${summary.failed}`,
      '',
      `📈 Доставляемость: ${deliveryRate}`,
      '',
      `👥 Пользователям: ${summary.toUsers}`,
      `👨‍💼 Администраторам: ${summary.toAdmins}`,
    ].join('\n');
    await editAdminMessage(message, text, {
      inline_keyboard: [
        [{ text: '📋 История рассылок', callback_data: 'admin:bc:history:0' }],
        [{ text: '⬅️ Назад', callback_data: 'admin:broadcasts' }],
        [homeButton()],
      ],
    });
  } catch (error) {
    if (!isBroadcastTableError(error)) throw error;
    await renderBroadcastMigrationMessage(message);
  }
}

// История рассылок со страницами; каждая строка открывает детали по id.
async function renderBroadcastHistory(
  admin: SupabaseClient,
  message: AdminMessage,
  page: number,
): Promise<void> {
  try {
    const { rows, total } = await listBroadcastHistory(admin, page);
    const pageCount = Math.max(1, Math.ceil(total / BROADCAST_HISTORY_PER_PAGE));
    const safePage = Math.min(page, pageCount - 1);

    const keyboard: InlineButton[][] = rows.map((row) => [
      { text: `📢 Рассылка #${row.id}`, callback_data: `admin:bc:view:${row.id}` },
    ]);

    if (pageCount > 1) {
      keyboard.push([
        {
          text: safePage > 0 ? '⬅️' : '·',
          callback_data: safePage > 0 ? `admin:bc:history:${safePage - 1}` : 'noop',
        },
        { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
        {
          text: safePage < pageCount - 1 ? '➡️' : '·',
          callback_data: safePage < pageCount - 1 ? `admin:bc:history:${safePage + 1}` : 'noop',
        },
      ]);
    }
    keyboard.push([{ text: '⬅️ К статистике', callback_data: 'admin:bc:statsmenu' }], [homeButton()]);

    const text =
      rows.length === 0
        ? '📋 История рассылок\n\nРассылок пока не было.'
        : [
            '📋 История рассылок',
            '',
            ...rows.map((row) =>
              [
                `📢 Рассылка #${row.id}`,
                `Дата: ${formatBroadcastDate(row.created_at)} · Аудитория: ${row.audience_title}`,
                `👥 ${row.recipients} · ✅ ${row.delivered} · ❌ ${row.failed}`,
              ].join('\n'),
            ),
          ].join('\n\n');

    await editAdminMessage(message, text, { inline_keyboard: keyboard });
  } catch (error) {
    if (!isBroadcastTableError(error)) throw error;
    await renderBroadcastMigrationMessage(message);
  }
}

// Подробная статистика конкретной рассылки по её id.
async function renderBroadcastDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  broadcastId: number,
): Promise<void> {
  try {
    const record = await getBroadcastRecord(admin, broadcastId);
    if (!record) {
      await editAdminMessage(message, `Рассылка #${broadcastId} не найдена.`, {
        inline_keyboard: [
          [{ text: '⬅️ К истории', callback_data: 'admin:bc:history:0' }],
          [homeButton()],
        ],
      });
      return;
    }

    const marks = [
      record.has_attachment ? '📎 вложение' : null,
      record.has_button ? '🔗 кнопка' : null,
    ].filter(Boolean);

    const text = [
      `📢 Рассылка #${record.id}`,
      '',
      'Дата:',
      formatBroadcastDate(record.created_at),
      '',
      'Аудитория:',
      record.audience_title,
      '',
      `👥 Получателей: ${record.recipients}`,
      `✅ Доставлено: ${record.delivered}`,
      `❌ Ошибок: ${record.failed}`,
      ...(marks.length > 0 ? ['', marks.join(' · ')] : []),
    ].join('\n');

    const keyboard: InlineButton[][] = [];
    if (record.failed > 0) {
      keyboard.push([{ text: '📋 Ошибки', callback_data: `admin:bc:err:${record.id}:0` }]);
    }
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'admin:bc:history:0' }], [homeButton()]);

    await editAdminMessage(message, text, { inline_keyboard: keyboard });
  } catch (error) {
    if (!isBroadcastTableError(error)) throw error;
    await renderBroadcastMigrationMessage(message);
  }
}

// Ошибки конкретной рассылки с пагинацией. id рассылки сидит в callback_data,
// поэтому переходы «статистика → рассылка → ошибки» не теряют контекст.
async function renderBroadcastErrorsPaged(
  admin: SupabaseClient,
  message: AdminMessage,
  broadcastId: number,
  page: number,
): Promise<void> {
  try {
    const record = await getBroadcastRecord(admin, broadcastId);
    if (!record) {
      await editAdminMessage(message, `Рассылка #${broadcastId} не найдена.`, {
        inline_keyboard: [
          [{ text: '⬅️ К статистике', callback_data: 'admin:bc:statsmenu' }],
          [homeButton()],
        ],
      });
      return;
    }

    const errors = record.errors;
    const pageCount = Math.max(1, Math.ceil(errors.length / BROADCAST_ERRORS_PER_PAGE));
    const safePage = Math.min(page, pageCount - 1);
    const slice = errors.slice(safePage * BROADCAST_ERRORS_PER_PAGE, (safePage + 1) * BROADCAST_ERRORS_PER_PAGE);

    const text =
      errors.length === 0
        ? `📋 Ошибки рассылки #${record.id}\n\nОшибок не было.`
        : [
            `📋 Ошибки рассылки #${record.id}`,
            '',
            ...slice.map((item) => `❌ ${item.name}\nПричина: ${item.reason}`),
            ...(errors.length > BROADCAST_ERROR_CAP - 1
              ? ['', `Показаны первые ${BROADCAST_ERROR_CAP} ошибок.`]
              : []),
          ].join('\n\n');

    const keyboard: InlineButton[][] = [];
    if (pageCount > 1) {
      keyboard.push([
        {
          text: safePage > 0 ? '⬅️' : '·',
          callback_data: safePage > 0 ? `admin:bc:err:${broadcastId}:${safePage - 1}` : 'noop',
        },
        { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
        {
          text: safePage < pageCount - 1 ? '➡️' : '·',
          callback_data: safePage < pageCount - 1 ? `admin:bc:err:${broadcastId}:${safePage + 1}` : 'noop',
        },
      ]);
    }
    keyboard.push(
      [{ text: '⬅️ Назад к статистике', callback_data: `admin:bc:view:${broadcastId}` }],
      [homeButton()],
    );

    await editAdminMessage(message, text, { inline_keyboard: keyboard });
  } catch (error) {
    if (!isBroadcastTableError(error)) throw error;
    await renderBroadcastMigrationMessage(message);
  }
}

async function cancelBroadcast(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
): Promise<void> {
  await clearStateIfAvailable(admin, telegramId);
  await editAdminMessage(message, '📢 Рассылка отменена.', homeOnlyKeyboard());
  await showAdminHome(message);
}

// Текстовые шаги рассылки: текст сообщения, текст и URL кнопки.
export async function handleBroadcastTextStep(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  text: string,
): Promise<boolean> {
  const payload = state.payload ?? {};
  const chatId = state.chat_id;
  const input = text.trim();

  if (state.step === 'broadcast:text') {
    if (!input) return true;
    if (input.length > BROADCAST_TEXT_LIMIT) {
      // Результат ввода — новое сообщение.
      await sendAdminMessage(
        chatId,
        `⚠️ Слишком длинный текст: максимум ${BROADCAST_TEXT_LIMIT} символов. Отправьте сокращённый вариант.`,
        {
          inline_keyboard: [
            [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
            [homeButton()],
          ],
        },
      );
      return true;
    }
    await renderBroadcastComposer(
      admin,
      telegramId,
      { ...state, step: 'broadcast:compose', payload: { ...payload, broadcastText: input } },
      sendDeliver(chatId),
      '✅ Текст сохранён.',
    );
    return true;
  }

  if (state.step === 'broadcast:button-text') {
    if (!input) return true;
    const messageId = await sendAdminMessage(chatId, '🔗 Теперь отправьте URL кнопки.\n\nНапример: https://example.com/webinar', {
      inline_keyboard: [
        [{ text: '↩️ Назад', callback_data: 'admin:bc:menu' }],
        [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
      ],
    });
    await saveState(
      admin,
      telegramId,
      { chatId, messageId: messageId ?? state.message_id },
      'broadcast:button-url',
      { ...payload, buttonText: shorten(input, 40) },
    );
    return true;
  }

  if (state.step === 'broadcast:button-url') {
    if (!isValidHttpUrl(input)) {
      await sendAdminMessage(chatId, '⚠️ Это не похоже на ссылку. Отправьте URL вида https://example.com', {
        inline_keyboard: [
          [{ text: '↩️ Назад', callback_data: 'admin:bc:menu' }],
          [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
        ],
      });
      return true;
    }
    await renderBroadcastComposer(
      admin,
      telegramId,
      { ...state, step: 'broadcast:compose', payload: { ...payload, buttonUrl: input } },
      sendDeliver(chatId),
      '✅ Кнопка сохранена.',
    );
    return true;
  }

  return false;
}

// Callback-кнопки рассылки (admin:broadcasts и admin:bc:*). Всегда возвращает true.
export async function handleBroadcastAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  if (data === 'admin:broadcasts') {
    await clearStateIfAvailable(admin, telegramId);
    await renderBroadcastMenu(editDeliver(message));
    return true;
  }

  if (data === 'admin:bc:new') {
    await clearStateIfAvailable(admin, telegramId);
    await renderBroadcastAudienceMenu(message);
    return true;
  }

  // «Отправить администраторам»: тот же конструктор, аудитория фиксированная.
  if (data === 'admin:bc:admins') {
    await clearStateIfAvailable(admin, telegramId);
    try {
      await startBroadcastText(admin, telegramId, message, BROADCAST_ADMINS_AUDIENCE);
    } catch (error) {
      if (!isConversationStateTableError(error)) throw error;
      await editAdminMessage(message, migrationText('bot_conversation_states.sql'), homeOnlyKeyboard());
    }
    return true;
  }

  // admin:bc:stats — легаси-кнопка старых сообщений со статистикой.
  if (data === 'admin:bc:statsmenu' || data === 'admin:bc:stats') {
    await renderBroadcastSummary(admin, message);
    return true;
  }

  if (data.startsWith('admin:bc:history:')) {
    await renderBroadcastHistory(admin, message, Math.max(0, Number(data.split(':')[3]) || 0));
    return true;
  }

  if (data.startsWith('admin:bc:view:')) {
    await renderBroadcastDetail(admin, message, Number(data.split(':')[3]) || 0);
    return true;
  }

  // admin:bc:err:<id рассылки>:<страница> — ошибки всегда привязаны к id.
  if (data.startsWith('admin:bc:err:')) {
    const parts = data.split(':');
    await renderBroadcastErrorsPaged(
      admin,
      message,
      Number(parts[3]) || 0,
      Math.max(0, Number(parts[4]) || 0),
    );
    return true;
  }

  // admin:bc:errors — легаси-кнопка: теперь ошибки хранятся по id рассылки.
  if (data === 'admin:bc:errors') {
    await renderBroadcastSummary(admin, message);
    return true;
  }

  let state: ConversationState | null = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  if (data === 'admin:bc:cancel') {
    await cancelBroadcast(admin, telegramId, message);
    return true;
  }

  const payload = state?.payload ?? {};
  const audience = findBroadcastAudience(payload.audience);

  if (data.startsWith('admin:bc:aud:')) {
    const selected = findBroadcastAudience(data.split(':')[3]);
    if (!selected || selected.id === BROADCAST_ADMINS_AUDIENCE.id) {
      await renderBroadcastAudienceMenu(message);
      return true;
    }
    try {
      await startBroadcastText(admin, telegramId, message, selected);
    } catch (error) {
      if (!isConversationStateTableError(error)) throw error;
      await editAdminMessage(message, migrationText('bot_conversation_states.sql'), homeOnlyKeyboard());
    }
    return true;
  }

  if (!state || state.chat_id !== message.chatId || !audience || !payload.broadcastText) {
    // Состояние потеряно (например, истекло) — возвращаем в начало сценария.
    await clearStateIfAvailable(admin, telegramId);
    await renderBroadcastMenu(editDeliver(message));
    return true;
  }

  const action = data === 'admin:bc:menu' ? 'menu' : data.split(':')[2] ?? '';

  switch (action) {
    case 'text': {
      await saveState(admin, telegramId, message, 'broadcast:text', payload);
      await editAdminMessage(
        message,
        `📢 Новая рассылка\n\nАудитория: ${audience.title}\n\nОтправьте новый текст сообщения.`,
        {
          inline_keyboard: [
            [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
            [homeButton()],
          ],
        },
      );
      return true;
    }
    case 'menu':
      await renderBroadcastComposer(admin, telegramId, state, editDeliver(message));
      return true;
    case 'attach':
      await renderBroadcastAttachPrompt(admin, telegramId, state);
      return true;
    case 'button':
      await renderBroadcastButtonText(admin, telegramId, state);
      return true;
    case 'preview':
      await renderBroadcastPreview(admin, telegramId, state);
      return true;
    case 'confirm':
      await renderBroadcastConfirm(admin, telegramId, state);
      return true;
    case 'send':
      await executeBroadcast(admin, telegramId, state);
      return true;
    default:
      await renderBroadcastComposer(admin, telegramId, state, editDeliver(message));
      return true;
  }
}
