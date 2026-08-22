import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  type BotRole,
  type MemberRow,
  countLeadsByPhone,
  getMember,
  isAdminEnv,
  isBotRole,
  listMembersInRoles,
  roleLabel,
  searchMembers,
  setRole,
} from '@/lib/bot/roles';
import {
  type ReminderType,
  type WebinarNotificationTemplate,
  createCustomWebinarNotificationTemplate,
  customReminderType,
  formatWebinarDateTime,
  getReminderTestWebinar,
  getWebinarNotificationTemplate,
  isReminderType,
  listReminderTestWebinars,
  listWebinarNotificationTemplates,
  removeWebinarNotificationTemplateFile,
  reminderTypeLabel,
  runWebinarReminderCheck,
  saveWebinarNotificationTemplate,
  sendReminderPreviewToAdmin,
} from '@/lib/webinarReminders';

// Единый сценарий админа: главное меню, управление вебинарами,
// шаблоны уведомлений и тестовые отправки.
// Префиксы callback_data (admin:, ar:, an:) сохранены без изменений:
// кнопки в старых чатах должны продолжать работать.

type AdminMessage = {
  chatId: number;
  messageId: number;
};

type InlineButton = Record<string, string>;

type InlineKeyboard = {
  inline_keyboard: Array<Array<InlineButton>>;
};

type Webinar = {
  id: string | number;
  title: string;
  description: string | null;
  webinar_date: string;
  registration_url: string | null;
  is_active: boolean;
};

// Общий payload состояния диалога: черновик вебинара и/или контекст
// редактируемого вебинара или настраиваемого шаблона уведомления.
// category/page — контекст навигации по пользователям для кнопки «Назад».
// Поля broadcast:* — конструктор массовой рассылки.
type AdminPayload = {
  title?: string;
  description?: string | null;
  webinar_date?: string;
  registration_url?: string | null;
  webinarId?: string;
  reminderType?: ReminderType;
  category?: string;
  page?: number;
  audience?: string;
  broadcastText?: string;
  attachmentKind?: BroadcastAttachmentKind;
  fileId?: string;
  fileName?: string;
  buttonText?: string;
  buttonUrl?: string;
  statsLine?: string;
  broadcastErrors?: string[];
};

type ConversationStep =
  | 'create:title'
  | 'create:description'
  | 'create:date'
  | 'create:url'
  | 'create:preview'
  | 'create:edit:title'
  | 'create:edit:description'
  | 'create:edit:date'
  | 'create:edit:url'
  | 'edit:title'
  | 'edit:description'
  | 'edit:date'
  | 'edit:url'
  | 'notification:custom-offset'
  | 'notification:text'
  | 'notification:file'
  | 'users:search'
  | 'broadcast:text'
  | 'broadcast:compose'
  | 'broadcast:button-text'
  | 'broadcast:button-url'
  | 'broadcast:preview'
  | 'broadcast:confirm'
  | 'broadcast:stats';

type ConversationState = {
  telegram_id: number;
  chat_id: number;
  message_id: number;
  step: ConversationStep;
  payload: AdminPayload;
};

type IncomingDocument = {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  // document — файл/PDF, photo — изображение (file_id максимального размера).
  kind?: 'document' | 'photo';
};

// ---------------------------------------------------------------------------
// Общая инфраструктура
// ---------------------------------------------------------------------------

async function isAdmin(admin: SupabaseClient, telegramId: number): Promise<boolean> {
  const { data, error } = await admin
    .from('bot_members')
    .select('role')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  return data?.role === 'admin';
}

async function editAdminMessage(
  message: AdminMessage,
  text: string,
  replyMarkup: InlineKeyboard,
): Promise<void> {
  const result = await telegramSend('editMessageText', {
    chat_id: message.chatId,
    message_id: message.messageId,
    text,
    reply_markup: replyMarkup,
  });

  // Telegram возвращает ошибку, когда экран уже содержит те же текст и кнопки.
  if (!result.ok && !result.description?.includes('message is not modified')) {
    throw new Error(result.description ?? 'Не удалось обновить административное сообщение.');
  }
}

// 42P01 — таблицы нет в БД, PGRST205 — PostgREST ещё не подхватил схему.
function isConversationStateTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('bot_conversation_states') ||
    (message.includes('relation') && message.includes('does not exist'))
  );
}

function isTemplateTableError(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  return message.includes('webinar_notification_templates');
}

async function getState(admin: SupabaseClient, telegramId: number): Promise<ConversationState | null> {
  const { data, error } = await admin
    .from('bot_conversation_states')
    .select('telegram_id, chat_id, message_id, step, payload')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as ConversationState) : null;
}

async function saveState(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  step: ConversationStep,
  payload: AdminPayload,
): Promise<void> {
  const { error } = await admin.from('bot_conversation_states').upsert(
    {
      telegram_id: telegramId,
      chat_id: message.chatId,
      message_id: message.messageId,
      step,
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'telegram_id' },
  );
  if (error) throw error;
}

async function clearState(admin: SupabaseClient, telegramId: number): Promise<void> {
  const { error } = await admin.from('bot_conversation_states').delete().eq('telegram_id', telegramId);
  if (error) throw error;
}

// Возврат в меню не должен ломаться, даже если миграция состояния ещё не применена.
async function clearStateIfAvailable(admin: SupabaseClient, telegramId: number): Promise<void> {
  try {
    await clearState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    console.error('Таблица состояния диалогов не применена:', error);
  }
}

function shorten(value: string, maximum = 40): string {
  return value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;
}

function migrationText(migrationFile: string): string {
  return `⚠️ Для этой функции нужно применить SQL-миграцию \`supabase/${migrationFile}\` в Supabase SQL Editor.`;
}

function homeButton(): InlineButton {
  return { text: '🏠 Главное меню админа', callback_data: 'admin:home' };
}

// ---------------------------------------------------------------------------
// Главное меню админа
// ---------------------------------------------------------------------------

const ADMIN_HOME_TEXT =
  '🔐 Панель администратора\n\n' +
  'Выбери раздел. Разделы в разработке помечены заглушкой.';

function adminHomeKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: '👥 Пользователи', callback_data: 'admin:users' }],
      [{ text: '📅 Вебинары', callback_data: 'admin:webinars' }],
      [{ text: '📢 Рассылки', callback_data: 'admin:broadcasts' }],
      [{ text: '📊 Статистика', callback_data: 'admin:stats' }],
      [{ text: '🚨 Контроль переписки', callback_data: 'admin:chat-control' }],
      [{ text: '🔔 Уведомления', callback_data: 'an:menu' }],
      [{ text: '🧪 Тест уведомлений', callback_data: 'ar:menu' }],
    ],
  };
}

async function showAdminHome(message: AdminMessage): Promise<void> {
  await editAdminMessage(message, ADMIN_HOME_TEXT, adminHomeKeyboard());
}

// Отправляет начальный экран роли admin после /start.
export async function sendAdminStart(chatId: number, testFooter = ''): Promise<void> {
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: ADMIN_HOME_TEXT + testFooter,
    reply_markup: adminHomeKeyboard(),
  });
}

// ---------------------------------------------------------------------------
// Управление вебинарами
// ---------------------------------------------------------------------------

const ADMIN_WEBINAR_CALLBACKS = {
  home: 'admin:home',
  menu: 'admin:webinars',
  create: 'admin:webinar:create',
  createConfirm: 'admin:webinar:create:confirm',
  createEdit: 'admin:webinar:create:edit',
  createCancel: 'admin:webinar:create:cancel',
  list: 'admin:webinar:list',
} as const;

function webinarCallback(...parts: Array<string | number>): string {
  return ['admin', 'webinar', ...parts.map(String)].join(':');
}

function managementKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: '➕ Создать вебинар', callback_data: ADMIN_WEBINAR_CALLBACKS.create }],
      [{ text: '📋 Все вебинары', callback_data: ADMIN_WEBINAR_CALLBACKS.list }],
      [homeButton()],
    ],
  };
}

function managementButton(): InlineButton {
  return { text: '↩️ К управлению вебинарами', callback_data: ADMIN_WEBINAR_CALLBACKS.menu };
}

function createCancelKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [[{ text: '❌ Отмена', callback_data: ADMIN_WEBINAR_CALLBACKS.createCancel }]],
  };
}

function backToWebinarKeyboard(webinarId: string): InlineKeyboard {
  return {
    inline_keyboard: [[{ text: '↩️ Отмена', callback_data: webinarCallback('view', webinarId, 'open') }]],
  };
}

function managementFallbackKeyboard(): InlineKeyboard {
  return { inline_keyboard: [[managementButton()], [homeButton()]] };
}

function formatWebinarDate(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'дата не указана';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(date);
}

function webinarStatus(webinar: Webinar): string {
  const date = new Date(webinar.webinar_date);
  if (!Number.isNaN(date.getTime()) && date.getTime() <= Date.now()) return '⏰ завершён';
  return webinar.is_active ? '🟢 активен' : '⚪ неактивен';
}

// Дата вводится в московском времени (UTC+3), храним в UTC.
function parseWebinarDate(value: string): string | null {
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, dayRaw, monthRaw, yearRaw, hourRaw, minuteRaw] = match;
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const date = new Date(Date.UTC(year, month - 1, day, hour - 3, minute));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  return date.toISOString();
}

function normalizeOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '-' ? null : trimmed;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function getWebinar(admin: SupabaseClient, webinarId: string): Promise<Webinar | null> {
  const { data, error } = await admin
    .from('webinars')
    .select('id, title, description, webinar_date, registration_url, is_active')
    .eq('id', webinarId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as Webinar) : null;
}

async function renderWebinarDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  webinarId: string,
  notice = '',
): Promise<void> {
  const webinar = await getWebinar(admin, webinarId);
  if (!webinar) {
    await editAdminMessage(message, 'Вебинар не найден или уже удалён.', managementFallbackKeyboard());
    return;
  }

  const text = [
    notice,
    `📅 ${webinar.title}`,
    '',
    `Описание: ${webinar.description ?? '—'}`,
    `Дата: ${formatWebinarDate(webinar.webinar_date)}`,
    `Ссылка: ${webinar.registration_url ?? '—'}`,
    `Статус: ${webinarStatus(webinar)}`,
  ].filter(Boolean).join('\n');

  await editAdminMessage(message, text, {
    inline_keyboard: [
      [{ text: '✏️ Изменить', callback_data: webinarCallback('view', webinar.id, 'edit') }],
      [
        {
          text: webinar.is_active ? '🔴 Деактивировать' : '🟢 Активировать',
          callback_data: webinarCallback('view', webinar.id, 'toggle'),
        },
      ],
      [{ text: '🗑 Удалить', callback_data: webinarCallback('view', webinar.id, 'delete') }],
      [managementButton()],
      [homeButton()],
    ],
  });
}

async function renderWebinarList(admin: SupabaseClient, message: AdminMessage): Promise<void> {
  const { data, error } = await admin
    .from('webinars')
    .select('id, title, webinar_date, is_active')
    .order('webinar_date', { ascending: false })
    .limit(100);
  if (error) throw error;

  const webinars = (data ?? []) as Webinar[];
  if (webinars.length === 0) {
    await editAdminMessage(message, '📋 Вебинаров пока нет.', {
      inline_keyboard: [
        [{ text: '➕ Создать вебинар', callback_data: ADMIN_WEBINAR_CALLBACKS.create }],
        [managementButton()],
      ],
    });
    return;
  }

  const text = ['📋 Все вебинары', '', ...webinars.map((webinar, index) => (
    `${index + 1}. ${webinar.title}\n${formatWebinarDate(webinar.webinar_date)} · ${webinarStatus(webinar)}`
  ))].join('\n\n');
  const buttons: InlineButton[][] = [];
  for (const webinar of webinars) {
    buttons.push([{ text: `📅 ${webinar.title}`, callback_data: webinarCallback('view', webinar.id, 'open') }]);
    buttons.push([
      { text: '✏️ Изменить', callback_data: webinarCallback('view', webinar.id, 'edit') },
      {
        text: webinar.is_active ? '🔴 Деактивировать' : '🟢 Активировать',
        callback_data: webinarCallback('view', webinar.id, 'toggle'),
      },
    ]);
    buttons.push([{ text: '🗑 Удалить', callback_data: webinarCallback('view', webinar.id, 'delete') }]);
  }
  buttons.push([managementButton()], [homeButton()]);

  await editAdminMessage(message, text, { inline_keyboard: buttons });
}

function createPreviewText(draft: AdminPayload): string {
  return [
    '📅 Новый вебинар',
    '',
    `Название: ${draft.title ?? '—'}`,
    `Описание: ${draft.description ?? '—'}`,
    `Дата: ${draft.webinar_date ? formatWebinarDate(draft.webinar_date) : '—'}`,
    `Ссылка: ${draft.registration_url ?? '—'}`,
  ].join('\n');
}

function previewKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: '✅ Создать', callback_data: ADMIN_WEBINAR_CALLBACKS.createConfirm }],
      [{ text: '✏️ Изменить', callback_data: ADMIN_WEBINAR_CALLBACKS.createEdit }],
      [{ text: '❌ Отмена', callback_data: ADMIN_WEBINAR_CALLBACKS.createCancel }],
    ],
  };
}

async function showCreatePreview(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  draft: AdminPayload,
): Promise<void> {
  await saveState(admin, telegramId, message, 'create:preview', draft);
  await editAdminMessage(message, createPreviewText(draft), previewKeyboard());
}

async function startCreate(admin: SupabaseClient, telegramId: number, message: AdminMessage): Promise<void> {
  await saveState(admin, telegramId, message, 'create:title', {});
  await editAdminMessage(message, 'Введите название вебинара:', createCancelKeyboard());
}

async function renderCreateEditChoices(message: AdminMessage): Promise<void> {
  await editAdminMessage(message, '✏️ Что изменить в черновике вебинара?', {
    inline_keyboard: [
      [{ text: 'Название', callback_data: webinarCallback('create', 'field', 'title') }],
      [{ text: 'Описание', callback_data: webinarCallback('create', 'field', 'description') }],
      [{ text: 'Дата и время', callback_data: webinarCallback('create', 'field', 'date') }],
      [{ text: 'Ссылка на регистрацию', callback_data: webinarCallback('create', 'field', 'url') }],
      [{ text: '↩️ К предпросмотру', callback_data: webinarCallback('create', 'preview') }],
      [{ text: '❌ Отмена', callback_data: ADMIN_WEBINAR_CALLBACKS.createCancel }],
    ],
  });
}

async function renderEditChoices(message: AdminMessage, webinarId: string): Promise<void> {
  await editAdminMessage(message, '✏️ Что изменить в вебинаре?', {
    inline_keyboard: [
      [{ text: 'Название', callback_data: webinarCallback('view', webinarId, 'field', 'title') }],
      [{ text: 'Описание', callback_data: webinarCallback('view', webinarId, 'field', 'description') }],
      [{ text: 'Дата и время', callback_data: webinarCallback('view', webinarId, 'field', 'date') }],
      [{ text: 'Ссылка на регистрацию', callback_data: webinarCallback('view', webinarId, 'field', 'url') }],
      [{ text: '↩️ Назад к вебинару', callback_data: webinarCallback('view', webinarId, 'open') }],
    ],
  });
}

async function renderDeleteConfirm(message: AdminMessage, webinarId: string): Promise<void> {
  await editAdminMessage(message, '⚠️ Вы уверены, что хотите удалить этот вебинар?', {
    inline_keyboard: [
      [{ text: '❌ Да, удалить', callback_data: webinarCallback('view', webinarId, 'delete-confirm') }],
      [{ text: '↩️ Отмена', callback_data: webinarCallback('view', webinarId, 'open') }],
    ],
  });
}

const FIELD_PROMPTS: Record<string, string> = {
  title: 'Введите новое название вебинара:',
  description: 'Введите новое описание. Отправьте «-», если описание не нужно:',
  date: 'Введите новую дату и время в формате:\n15.09.2026 19:00',
  url: 'Введите новую ссылку на регистрацию. Отправьте «-», если ссылка не нужна:',
};

const CREATE_FIELD_STEPS: Record<string, ConversationStep> = {
  title: 'create:edit:title',
  description: 'create:edit:description',
  date: 'create:edit:date',
  url: 'create:edit:url',
};

const EDIT_FIELD_STEPS: Record<string, ConversationStep> = {
  title: 'edit:title',
  description: 'edit:description',
  date: 'edit:date',
  url: 'edit:url',
};

async function renderCreationStep(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  input: string,
): Promise<void> {
  const message = { chatId: state.chat_id, messageId: state.message_id };
  const payload = { ...(state.payload ?? {}) } as AdminPayload;
  const isFieldEdit = state.step.startsWith('create:edit:');

  if (state.step === 'create:title' || state.step === 'create:edit:title') {
    if (!input) {
      await editAdminMessage(message, 'Название не может быть пустым. Введите название вебинара:', createCancelKeyboard());
      return;
    }
    payload.title = input;
    if (isFieldEdit) {
      await showCreatePreview(admin, telegramId, message, payload);
    } else {
      await saveState(admin, telegramId, message, 'create:description', payload);
      await editAdminMessage(message, 'Введите описание вебинара. Отправьте «-», если описание не нужно:', createCancelKeyboard());
    }
    return;
  }

  if (state.step === 'create:description' || state.step === 'create:edit:description') {
    payload.description = normalizeOptional(input);
    if (isFieldEdit) {
      await showCreatePreview(admin, telegramId, message, payload);
    } else {
      await saveState(admin, telegramId, message, 'create:date', payload);
      await editAdminMessage(message, 'Введите дату и время вебинара в формате:\n15.09.2026 19:00', createCancelKeyboard());
    }
    return;
  }

  if (state.step === 'create:date' || state.step === 'create:edit:date') {
    const date = parseWebinarDate(input);
    if (!date) {
      await editAdminMessage(message, 'Неверный формат. Введите дату и время так:\n15.09.2026 19:00', createCancelKeyboard());
      return;
    }
    payload.webinar_date = date;
    if (isFieldEdit) {
      await showCreatePreview(admin, telegramId, message, payload);
    } else {
      await saveState(admin, telegramId, message, 'create:url', payload);
      await editAdminMessage(message, 'Введите ссылку на регистрацию. Отправьте «-», если ссылка не нужна:', createCancelKeyboard());
    }
    return;
  }

  if (state.step === 'create:url' || state.step === 'create:edit:url') {
    const url = normalizeOptional(input);
    if (url && !isValidHttpUrl(url)) {
      await editAdminMessage(message, 'Укажите корректную ссылку с http:// или https://, либо отправьте «-».', createCancelKeyboard());
      return;
    }
    payload.registration_url = url;
    await showCreatePreview(admin, telegramId, message, payload);
  }
}

async function renderExistingEditStep(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  input: string,
): Promise<void> {
  const message = { chatId: state.chat_id, messageId: state.message_id };
  const webinarId = String(state.payload?.webinarId ?? '');
  if (!webinarId) {
    await clearState(admin, telegramId);
    await editAdminMessage(message, 'Состояние редактирования устарело. Откройте вебинар заново.', {
      inline_keyboard: [[managementButton()]],
    });
    return;
  }

  let patch: Record<string, string | null> | null = null;
  if (state.step === 'edit:title') {
    if (!input) {
      await editAdminMessage(message, 'Название не может быть пустым. Введите название вебинара:', backToWebinarKeyboard(webinarId));
      return;
    }
    patch = { title: input };
  }
  if (state.step === 'edit:description') patch = { description: normalizeOptional(input) };
  if (state.step === 'edit:date') {
    const date = parseWebinarDate(input);
    if (!date) {
      await editAdminMessage(message, 'Неверный формат. Введите дату и время так:\n15.09.2026 19:00', backToWebinarKeyboard(webinarId));
      return;
    }
    patch = { webinar_date: date };
  }
  if (state.step === 'edit:url') {
    const url = normalizeOptional(input);
    if (url && !isValidHttpUrl(url)) {
      await editAdminMessage(message, 'Укажите корректную ссылку с http:// или https://, либо отправьте «-».', backToWebinarKeyboard(webinarId));
      return;
    }
    patch = { registration_url: url };
  }

  if (!patch) return;
  const { error } = await admin
    .from('webinars')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', webinarId);
  if (error) throw error;
  await clearState(admin, telegramId);
  await renderWebinarDetail(admin, message, webinarId, '✅ Вебинар обновлён.');
}

function parseViewCallback(data: string): { webinarId: string; action: string; field?: string } | null {
  const parts = data.split(':');
  if (parts[0] !== 'admin' || parts[1] !== 'webinar' || parts[2] !== 'view' || parts.length < 5) {
    return null;
  }
  return { webinarId: parts[3], action: parts[4], field: parts[5] };
}

async function createWebinarFromDraft(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
): Promise<void> {
  const state = await getState(admin, telegramId);
  const draft = state?.payload ?? {};
  if (state?.step !== 'create:preview' || !draft.title || !draft.webinar_date) {
    await editAdminMessage(message, 'Черновик вебинара не найден. Начните создание заново.', {
      inline_keyboard: [
        [{ text: '➕ Создать вебинар', callback_data: ADMIN_WEBINAR_CALLBACKS.create }],
        [managementButton()],
      ],
    });
    return;
  }

  const { data, error } = await admin
    .from('webinars')
    .insert({
      title: draft.title,
      description: draft.description ?? null,
      webinar_date: draft.webinar_date,
      registration_url: draft.registration_url ?? null,
      is_active: true,
    })
    .select('id')
    .single();
  if (error) throw error;

  await clearState(admin, telegramId);
  await renderWebinarDetail(admin, message, String(data.id), '✅ Вебинар создан.');
}

async function deleteWebinar(
  admin: SupabaseClient,
  message: AdminMessage,
  webinarId: string,
): Promise<void> {
  const { count, error: countError } = await admin
    .from('webinar_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('webinar_id', webinarId);
  if (countError) throw countError;

  if ((count ?? 0) > 0) {
    await editAdminMessage(
      message,
      'Нельзя удалить вебинар: для него уже есть регистрации. Данные сохранены.',
      managementFallbackKeyboard(),
    );
    return;
  }

  const { error } = await admin.from('webinars').delete().eq('id', webinarId);
  if (error) {
    if (error.code === '23503') {
      await editAdminMessage(message, 'Нельзя удалить вебинар из-за связанных данных. Данные сохранены.', managementFallbackKeyboard());
      return;
    }
    throw error;
  }

  await editAdminMessage(message, '✅ Вебинар удалён.', managementFallbackKeyboard());
}

// Callback-кнопки управления вебинарами (префикс admin:). Всегда возвращает true.
async function handleWebinarAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  if (data === ADMIN_WEBINAR_CALLBACKS.menu) {
    await editAdminMessage(message, '📅 Управление вебинарами', managementKeyboard());
    return true;
  }

  if (data === ADMIN_WEBINAR_CALLBACKS.create) {
    try {
      await startCreate(admin, telegramId, message);
    } catch (error) {
      console.error('Не удалось начать создание вебинара:', error);
      if (isConversationStateTableError(error)) {
        await editAdminMessage(message, migrationText('bot_conversation_states.sql'), managementFallbackKeyboard());
      } else {
        await editAdminMessage(message, '⚠️ Не удалось открыть создание вебинара. Проверьте подключение к Supabase и повторите попытку.', managementFallbackKeyboard());
      }
    }
    return true;
  }

  if (data === ADMIN_WEBINAR_CALLBACKS.createCancel) {
    await clearStateIfAvailable(admin, telegramId);
    await editAdminMessage(message, 'Создание вебинара отменено.', managementKeyboard());
    return true;
  }

  if (data === ADMIN_WEBINAR_CALLBACKS.createEdit) {
    const state = await getState(admin, telegramId);
    if (state?.step === 'create:preview') await renderCreateEditChoices(message);
    return true;
  }

  if (data === webinarCallback('create', 'preview')) {
    const state = await getState(admin, telegramId);
    if (state?.step === 'create:preview') {
      await editAdminMessage(message, createPreviewText(state.payload ?? {}), previewKeyboard());
    }
    return true;
  }

  if (data === ADMIN_WEBINAR_CALLBACKS.createConfirm) {
    await createWebinarFromDraft(admin, telegramId, message);
    return true;
  }

  if (data.startsWith(webinarCallback('create', 'field'))) {
    const field = data.split(':').at(-1);
    const state = await getState(admin, telegramId);
    if (!field || !CREATE_FIELD_STEPS[field] || !state?.payload) return true;

    await saveState(admin, telegramId, message, CREATE_FIELD_STEPS[field], state.payload);
    await editAdminMessage(message, FIELD_PROMPTS[field], {
      inline_keyboard: [[{ text: '↩️ К предпросмотру', callback_data: webinarCallback('create', 'preview') }]],
    });
    return true;
  }

  if (data === ADMIN_WEBINAR_CALLBACKS.list) {
    await renderWebinarList(admin, message);
    return true;
  }

  const view = parseViewCallback(data);
  if (!view) {
    // Неизвестная admin:-кнопка — возвращаем домой вместо «мёртвого» экрана.
    await showAdminHome(message);
    return true;
  }

  if (view.action === 'open') {
    await renderWebinarDetail(admin, message, view.webinarId);
    return true;
  }

  if (view.action === 'edit') {
    await renderEditChoices(message, view.webinarId);
    return true;
  }

  if (view.action === 'field' && view.field) {
    if (!EDIT_FIELD_STEPS[view.field]) return true;

    await saveState(admin, telegramId, message, EDIT_FIELD_STEPS[view.field], { webinarId: view.webinarId });
    await editAdminMessage(message, FIELD_PROMPTS[view.field], backToWebinarKeyboard(view.webinarId));
    return true;
  }

  if (view.action === 'toggle') {
    const webinar = await getWebinar(admin, view.webinarId);
    if (!webinar) {
      await renderWebinarDetail(admin, message, view.webinarId);
      return true;
    }
    const { error } = await admin
      .from('webinars')
      .update({ is_active: !webinar.is_active, updated_at: new Date().toISOString() })
      .eq('id', view.webinarId);
    if (error) throw error;
    await renderWebinarDetail(admin, message, view.webinarId, '✅ Статус вебинара обновлён.');
    return true;
  }

  if (view.action === 'delete') {
    await renderDeleteConfirm(message, view.webinarId);
    return true;
  }

  if (view.action === 'delete-confirm') {
    await deleteWebinar(admin, message, view.webinarId);
    return true;
  }

  await showAdminHome(message);
  return true;
}

// ---------------------------------------------------------------------------
// Выбор вебинара (общий список для тестов уведомлений и шаблонов)
// ---------------------------------------------------------------------------

async function renderWebinarPicker(
  admin: SupabaseClient,
  message: AdminMessage,
  options: {
    text: string;
    emptyText: string;
    pickCallback: (webinarId: string) => string;
    backButtons: InlineButton[][];
  },
): Promise<void> {
  const webinars = await listReminderTestWebinars(admin);
  if (webinars.length === 0) {
    await editAdminMessage(message, options.emptyText, { inline_keyboard: options.backButtons });
    return;
  }

  const keyboard: InlineButton[][] = webinars.map((webinar) => {
    const { date, time } = formatWebinarDateTime(webinar.webinar_date);
    return [{
      text: `📅 ${shorten(webinar.title)} · ${date} ${time}`,
      callback_data: options.pickCallback(String(webinar.id)),
    }];
  });
  keyboard.push(...options.backButtons);

  await editAdminMessage(message, options.text, { inline_keyboard: keyboard });
}

// ---------------------------------------------------------------------------
// Тестирование уведомлений (префикс ar:)
// ---------------------------------------------------------------------------

const REMINDER_MENU_TEXT =
  '🧪 Тестирование уведомлений о вебинарах\n\n' +
  'Тестовая отправка приходит только текущему администратору и не меняет регистрации, даты вебинара или журнал webinar_reminder_sends.\n\n' +
  'Проверка cron запускает ту же логику определения сроков, но не отправляет сообщения и не создаёт записи.';

function reminderMenuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: '📨 Отправить тестовое уведомление себе', callback_data: 'ar:list' }],
      [{ text: '🔎 Проверить cron-логику без отправки', callback_data: 'ar:check' }],
      [homeButton()],
    ],
  };
}

function reminderBackButtons(): InlineButton[][] {
  return [[{ text: '↩️ К тестированию уведомлений', callback_data: 'ar:menu' }], [homeButton()]];
}

function formatCronCheckResult(
  summary: Awaited<ReturnType<typeof runWebinarReminderCheck>>,
): string {
  const lines = [
    '🔎 Проверка cron-логики завершена',
    '',
    `Активных будущих вебинаров: ${summary.processedWebinars}`,
    `Напоминаний к отправке сейчас: ${summary.planned}`,
    `Уже отправлено ранее: ${summary.skippedAlreadySent}`,
    `Пропущено некорректных получателей: ${summary.skippedInvalidRecipient}`,
    `Пропущено без сохранённого шаблона: ${summary.skippedMissingTemplate}`,
    `Ошибок чтения: ${summary.failed}`,
  ];

  if (summary.due.length > 0) {
    lines.push('', 'Сработавшие контрольные точки:');
    for (const item of summary.due.slice(0, 10)) {
      lines.push(
        `• ${reminderTypeLabel(item.reminderType, item.offsetMinutesBefore)}: ${shorten(item.title, 34)} — получателей ${item.recipients}`,
      );
    }
    if (summary.due.length > 10) lines.push(`… и ещё ${summary.due.length - 10}.`);
  } else {
    lines.push('', 'Сейчас ни для одного активного вебинара не наступила контрольная точка.');
  }

  lines.push('', 'Сообщения не отправлялись, таблица webinar_reminder_sends не изменялась.');
  return lines.join('\n');
}

async function renderReminderTypeSelection(
  admin: SupabaseClient,
  message: AdminMessage,
  webinarId: string,
): Promise<void> {
  const webinar = await getReminderTestWebinar(admin, webinarId);
  if (!webinar) {
    await editAdminMessage(message, 'Вебинар не найден. Выберите его заново.', {
      inline_keyboard: [[{ text: '📨 Выбрать вебинар', callback_data: 'ar:list' }], [homeButton()]],
    });
    return;
  }

  const templates = await listWebinarNotificationTemplates(admin, webinar.id);
  const { date, time } = formatWebinarDateTime(webinar.webinar_date);
  const keyboard: InlineButton[][] = templates.map((template) => [
    {
      text: `${template.message_text.trim() ? '🔔' : '⚪'} ${reminderTypeLabel(template.reminder_type, template.offset_minutes_before)}`,
      callback_data: `ar:send:${webinar.id}:${template.reminder_type}`,
    },
  ]);
  keyboard.push([{ text: '↩️ Выбрать другой вебинар', callback_data: 'ar:list' }], [homeButton()]);

  await editAdminMessage(
    message,
    `🧪 Тестовое уведомление\n\nВебинар: ${webinar.title}\nДата: ${date} ${time}\n\nВыберите сохранённый шаблон. Сообщение получит только ваш Telegram-аккаунт.`,
    { inline_keyboard: keyboard },
  );
}

// Callback-кнопки тестирования уведомлений (префикс ar:). Всегда возвращает true.
async function handleReminderAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  const parts = data.split(':');
  const action = parts[1];

  if (action === 'list') {
    await renderWebinarPicker(admin, message, {
      text: '📨 Выберите существующий вебинар для тестового уведомления. Сообщение будет отправлено только вам.',
      emptyText: '📭 Вебинаров для тестирования пока нет.',
      pickCallback: (webinarId) => `ar:webinar:${webinarId}`,
      backButtons: reminderBackButtons(),
    });
    return true;
  }

  if (action === 'webinar' && parts[2]) {
    await renderReminderTypeSelection(admin, message, parts[2]);
    return true;
  }

  if (action === 'send' && parts[2] && isReminderType(parts[3])) {
    const reminderType = parts[3] as ReminderType;
    const webinar = await getReminderTestWebinar(admin, parts[2]);
    if (!webinar) {
      await editAdminMessage(message, 'Тестовый сценарий устарел. Выберите вебинар заново.', {
        inline_keyboard: [[{ text: '📨 Выбрать вебинар', callback_data: 'ar:list' }], [homeButton()]],
      });
      return true;
    }

    try {
      await sendReminderPreviewToAdmin(admin, telegramId, webinar, reminderType);
      await editAdminMessage(
        message,
        `✅ Тестовое уведомление «${reminderTypeLabel(reminderType)}» отправлено только вам.\n\nРегистрации, дата вебинара и webinar_reminder_sends не изменялись.`,
        reminderMenuKeyboard(),
      );
    } catch (error) {
      const description = error instanceof Error ? error.message : 'Не удалось отправить тестовое уведомление.';
      await editAdminMessage(message, `⚠️ Тест не отправлен.\n\n${description}`, reminderMenuKeyboard());
    }
    return true;
  }

  if (action === 'check') {
    const summary = await runWebinarReminderCheck(admin, { dryRun: true });
    await editAdminMessage(message, formatCronCheckResult(summary), reminderMenuKeyboard());
    return true;
  }

  // 'menu' и неизвестные ar:-кнопки — меню тестирования.
  await editAdminMessage(message, REMINDER_MENU_TEXT, reminderMenuKeyboard());
  return true;
}

// ---------------------------------------------------------------------------
// Шаблоны уведомлений (префикс an:)
// ---------------------------------------------------------------------------

const FIXED_REMINDER_TYPES: ReminderType[] = ['3_days', '1_day', '6_hours', '15_minutes'];

function templatesMenuButton(): InlineButton {
  return { text: '↩️ К уведомлениям', callback_data: 'an:menu' };
}

function templatesMenuKeyboard(): InlineKeyboard {
  return { inline_keyboard: [[templatesMenuButton()], [homeButton()]] };
}

function safeMinutes(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

// Короткий ключ для callback_data: фиксированные типы как есть,
// произвольные — как c<минуты>, чтобы уложиться в лимит 64 символа.
function callbackKey(reminderType: ReminderType, offsetMinutesBefore?: number): string {
  return FIXED_REMINDER_TYPES.includes(reminderType)
    ? reminderType
    : `c${offsetMinutesBefore ?? reminderType.match(/^custom_(\d+)_minutes$/)?.[1] ?? ''}`;
}

function templateStatus(template: WebinarNotificationTemplate | undefined): string {
  if (!template) return '⚪ не настроено';
  const text = template.message_text.trim() ? 'текст: ✅' : 'текст: ❌';
  const file = template.file_id ? 'файл: ✅' : 'файл: —';
  return `${text}, ${file}`;
}

async function renderTemplateMigrationMessage(message: AdminMessage): Promise<void> {
  await editAdminMessage(message, migrationText('webinar_notification_templates.sql'), templatesMenuKeyboard());
}

async function renderTemplateTypes(
  admin: SupabaseClient,
  message: AdminMessage,
  webinarId: string,
): Promise<void> {
  const webinar = await getReminderTestWebinar(admin, webinarId);
  if (!webinar) {
    await editAdminMessage(message, 'Вебинар не найден. Выберите его заново.', {
      inline_keyboard: [[{ text: '📅 Выбрать вебинар', callback_data: 'an:menu' }], [homeButton()]],
    });
    return;
  }

  const templates = await listWebinarNotificationTemplates(admin, webinar.id);
  const templateByType = new Map(templates.map((template) => [template.reminder_type, template]));
  const customTemplates = templates.filter((template) => !FIXED_REMINDER_TYPES.includes(template.reminder_type));
  const { date, time } = formatWebinarDateTime(webinar.webinar_date);
  const keyboard: InlineButton[][] = FIXED_REMINDER_TYPES.map((reminderType) => [
    {
      text: `🔔 ${reminderTypeLabel(reminderType)} · ${templateStatus(templateByType.get(reminderType))}`,
      callback_data: `an:t:${webinar.id}:${reminderType}`,
    },
  ]);

  for (const template of customTemplates) {
    keyboard.push([
      {
        text: `⏱ ${reminderTypeLabel(template.reminder_type, template.offset_minutes_before)} · ${templateStatus(template)}`,
        callback_data: `an:t:${webinar.id}:${callbackKey(template.reminder_type, template.offset_minutes_before)}`,
      },
    ]);
  }

  keyboard.push(
    [{ text: '➕ Другое время до вебинара', callback_data: `an:c:${webinar.id}` }],
    [{ text: '↩️ Другой вебинар', callback_data: 'an:menu' }],
    [homeButton()],
  );

  await editAdminMessage(
    message,
    `🔔 Уведомления\n\nВебинар: ${webinar.title}\nДата: ${date} ${time}\n\nВыберите момент напоминания или добавьте произвольное время.`,
    { inline_keyboard: keyboard },
  );
}

async function renderTemplateDetail(
  admin: SupabaseClient,
  message: AdminMessage,
  webinarId: string,
  reminderType: ReminderType,
): Promise<void> {
  const webinar = await getReminderTestWebinar(admin, webinarId);
  if (!webinar) {
    await editAdminMessage(message, 'Вебинар не найден. Выберите его заново.', {
      inline_keyboard: [[{ text: '📅 Выбрать вебинар', callback_data: 'an:menu' }], [homeButton()]],
    });
    return;
  }

  const template = await getWebinarNotificationTemplate(admin, webinar.id, reminderType);
  const label = reminderTypeLabel(reminderType, template?.offset_minutes_before);
  const textPreview = template?.message_text.trim()
    ? shorten(template.message_text.replace(/\s+/g, ' '), 600)
    : 'Текст пока не задан.';
  const fileStatus = template?.file_id
    ? `✅ Прикреплён: ${template.file_type ?? 'документ'}`
    : '— Файл не прикреплён.';
  const detailCallbackKey = callbackKey(reminderType, template?.offset_minutes_before);
  const keyboard: InlineButton[][] = [
    [{ text: '📝 Изменить текст', callback_data: `an:x:${webinar.id}:${detailCallbackKey}` }],
    [{ text: '📎 Прикрепить PDF / документ', callback_data: `an:f:${webinar.id}:${detailCallbackKey}` }],
    [{ text: '📭 Сохранить без файла', callback_data: `an:n:${webinar.id}:${detailCallbackKey}` }],
  ];
  if (template?.file_id) {
    keyboard.push([{ text: '🗑 Удалить прикреплённый файл', callback_data: `an:d:${webinar.id}:${detailCallbackKey}` }]);
  }
  keyboard.push([{ text: '↩️ К типам уведомлений', callback_data: `an:w:${webinar.id}` }], [homeButton()]);

  await editAdminMessage(
    message,
    `🔔 ${label}\n\nВебинар: ${webinar.title}\n\nТекст:\n${textPreview}\n\nФайл: ${fileStatus}\n\nТекст и файл сохраняются отдельно. Файл необязателен.`,
    { inline_keyboard: keyboard },
  );
}

function parseTemplateTarget(
  parts: string[],
): { webinarId: string; reminderType: ReminderType; callbackKey: string } | null {
  const webinarId = parts[2];
  const token = parts[3];
  if (!webinarId || !token) return null;
  if (isReminderType(token)) return { webinarId, reminderType: token, callbackKey: token };

  const customOffset = token.match(/^c([1-9][0-9]*)$/)?.[1];
  if (!customOffset) return null;
  return {
    webinarId,
    reminderType: customReminderType(Number(customOffset)),
    callbackKey: token,
  };
}

// Callback-кнопки шаблонов уведомлений (префикс an:). Всегда возвращает true.
async function handleTemplateAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  const parts = data.split(':');
  const action = parts[1];

  if (action === 'menu') {
    await clearStateIfAvailable(admin, telegramId);
    await renderWebinarPicker(admin, message, {
      text: '🔔 Уведомления вебинара\n\nВыберите вебинар, для которого хотите настроить тексты, вложения и время отправки.',
      emptyText: '📭 Вебинаров пока нет.',
      pickCallback: (webinarId) => `an:w:${webinarId}`,
      backButtons: [[homeButton()]],
    });
    return true;
  }

  if (action === 'w' && parts[2]) {
    await clearStateIfAvailable(admin, telegramId);
    await renderTemplateTypes(admin, message, parts[2]);
    return true;
  }

  if (action === 'c' && parts[2]) {
    try {
      await saveState(admin, telegramId, message, 'notification:custom-offset', { webinarId: parts[2] });
    } catch (error) {
      if (isConversationStateTableError(error)) {
        await editAdminMessage(message, migrationText('bot_conversation_states.sql'), templatesMenuKeyboard());
        return true;
      }
      throw error;
    }
    await editAdminMessage(
      message,
      '⏱ Отправьте следующим сообщением целое число минут до начала вебинара.\n\nНапример: `90` — уведомление за 1 час 30 минут.\n\nВремя должно быть больше нуля.',
      {
        inline_keyboard: [[{ text: '↩️ Отмена', callback_data: `an:w:${parts[2]}` }], [homeButton()]],
      },
    );
    return true;
  }

  const target = parseTemplateTarget(parts);
  if (!target) {
    await renderWebinarPicker(admin, message, {
      text: '🔔 Уведомления вебинара\n\nВыберите вебинар, для которого хотите настроить тексты, вложения и время отправки.',
      emptyText: '📭 Вебинаров пока нет.',
      pickCallback: (webinarId) => `an:w:${webinarId}`,
      backButtons: [[homeButton()]],
    });
    return true;
  }

  if (action === 't') {
    await clearStateIfAvailable(admin, telegramId);
    await renderTemplateDetail(admin, message, target.webinarId, target.reminderType);
    return true;
  }

  if (action === 'x' || action === 'f') {
    try {
      await saveState(
        admin,
        telegramId,
        message,
        action === 'x' ? 'notification:text' : 'notification:file',
        { webinarId: target.webinarId, reminderType: target.reminderType },
      );
    } catch (error) {
      if (isConversationStateTableError(error)) {
        await editAdminMessage(message, migrationText('bot_conversation_states.sql'), templatesMenuKeyboard());
        return true;
      }
      throw error;
    }

    await editAdminMessage(
      message,
      action === 'x'
        ? `📝 Отправьте следующим сообщением новый текст уведомления «${reminderTypeLabel(target.reminderType)}». Он сохранится сразу.`
        : `📎 Отправьте следующим сообщением PDF или документ для уведомления «${reminderTypeLabel(target.reminderType)}». Бот сохранит Telegram file_id автоматически.`,
      {
        inline_keyboard: [
          [{ text: '↩️ Отмена', callback_data: `an:t:${target.webinarId}:${target.callbackKey}` }],
          [homeButton()],
        ],
      },
    );
    return true;
  }

  if (action === 'd' || action === 'n') {
    await removeWebinarNotificationTemplateFile(admin, target.webinarId, target.reminderType);
    await renderTemplateDetail(admin, message, target.webinarId, target.reminderType);
    return true;
  }

  await renderTemplateTypes(admin, message, target.webinarId);
  return true;
}

// Текстовый шаг настройки шаблонов: произвольный офсет или новый текст.
async function handleNotificationTextStep(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  text: string,
): Promise<boolean> {
  const message = { chatId: state.chat_id, messageId: state.message_id };
  const payload = state.payload ?? {};
  const webinarId = payload.webinarId;
  if (!webinarId) {
    await clearState(admin, telegramId);
    return false;
  }

  try {
    if (state.step === 'notification:custom-offset') {
      const minutes = safeMinutes(text);
      if (!minutes) {
        await telegramSend('sendMessage', {
          chat_id: state.chat_id,
          text: 'Введите целое положительное число минут, например: 90.',
        });
        return true;
      }
      const template = await createCustomWebinarNotificationTemplate(admin, webinarId, minutes);
      await clearState(admin, telegramId);
      await renderTemplateDetail(admin, message, webinarId, template.reminder_type);
      return true;
    }

    const reminderType = payload.reminderType;
    if (state.step !== 'notification:text' || !reminderType || !isReminderType(reminderType)) return false;
    await saveWebinarNotificationTemplate(admin, {
      webinarId,
      reminderType,
      messageText: text.trim(),
    });
    await clearState(admin, telegramId);
    await renderTemplateDetail(admin, message, webinarId, reminderType);
    return true;
  } catch (error) {
    if (isTemplateTableError(error)) {
      await renderTemplateMigrationMessage(message);
      return true;
    }
    if (error instanceof Error) {
      await telegramSend('sendMessage', { chat_id: state.chat_id, text: `⚠️ ${error.message}` });
      return true;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Панель администратора: пользователи и роли
// ---------------------------------------------------------------------------

// Точные callback'и панели. admin:user:* и admin:cat:* матчатся по префиксу.
const PANEL_CALLBACKS = [
  'admin:home',
  'admin:users',
  'admin:users:search',
  'admin:stats',
  'admin:chat-control',
];

function isPanelAction(data: string): boolean {
  return (
    PANEL_CALLBACKS.includes(data) ||
    data.startsWith('admin:user:') ||
    data.startsWith('admin:cat:')
  );
}

const STUB_SECTION_TEXT = '🚧 Раздел находится в разработке.';

// Роли, которые админ назначает через панель. test — только владелец бота.
const ASSIGNABLE_ROLES: BotRole[] = ['guest', 'student', 'curator', 'teacher', 'admin'];

// Размер страницы списка пользователей: в одно сообщение Telegram
// помещается ограниченное число кнопок.
const USERS_PER_PAGE = 5;

// Категории пользователей. «Платные» и «Ученики» пока определяются ролью
// student (в bot_members она означает «купил курс»): отдельных таблиц
// оплат и доступов в проекте нет. «Кураторы» включают легаси-роль mentor.
type UserCategoryId = 'all' | 'guest' | 'paid' | 'student' | 'curator' | 'teacher' | 'admin';

type UserCategory = {
  id: UserCategoryId;
  buttonLabel: string;
  title: string;
  roles: string[];
};

const USER_CATEGORIES: UserCategory[] = [
  { id: 'all', buttonLabel: '👥 Все пользователи', title: 'Все пользователи', roles: ['guest', 'student', 'curator', 'teacher', 'mentor', 'admin', 'test'] },
  { id: 'guest', buttonLabel: '❄️ Гости', title: 'Гости', roles: ['guest'] },
  { id: 'paid', buttonLabel: '💳 Платные пользователи', title: 'Платные пользователи', roles: ['student'] },
  { id: 'student', buttonLabel: '🎓 Ученики', title: 'Ученики', roles: ['student'] },
  { id: 'curator', buttonLabel: '🟡 Кураторы', title: 'Кураторы / менторы', roles: ['curator', 'mentor'] },
  { id: 'teacher', buttonLabel: '🟠 Преподаватели', title: 'Преподаватели', roles: ['teacher'] },
  { id: 'admin', buttonLabel: '🔐 Администраторы', title: 'Администраторы', roles: ['admin'] },
];

function findCategory(id: string): UserCategory | undefined {
  return USER_CATEGORIES.find((category) => category.id === id);
}

function memberDisplayName(member: MemberRow): string {
  return member.full_name?.trim() || `ID ${member.telegram_id}`;
}

// «✈️ Telegram подключён» — у участника сохранён chat_id, то есть бот
// может доставлять ему сообщения.
function memberCard(member: MemberRow): string {
  const lines = [`👤 ${memberDisplayName(member)}`];
  if (member.phone) lines.push(`📱 ${member.phone}`);
  lines.push(`✈️ Telegram: ${member.chat_id ? 'подключён' : 'не подключён'}`);
  lines.push(`🎭 Роль: ${roleLabel(member.role)}`);
  return lines.join('\n');
}

function homeOnlyKeyboard(): InlineKeyboard {
  return { inline_keyboard: [[homeButton()]] };
}

async function renderUsersMenu(admin: SupabaseClient, telegramId: number, message: AdminMessage): Promise<void> {
  // Вне активного поиска текст админа не должен попадать в поиск.
  await clearStateIfAvailable(admin, telegramId);
  const keyboard: InlineButton[][] = [
    [{ text: '🔎 Поиск пользователя', callback_data: 'admin:users:search' }],
    ...USER_CATEGORIES.map((category) => [
      { text: category.buttonLabel, callback_data: `admin:cat:${category.id}:0` },
    ]),
    [homeButton()],
  ];
  await editAdminMessage(
    message,
    '👥 Пользователи\n\nВыбери категорию или найди пользователя по имени и телефону.',
    { inline_keyboard: keyboard },
  );
}

async function renderUserSearchPrompt(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
): Promise<void> {
  await saveState(admin, telegramId, message, 'users:search', {});
  await editAdminMessage(
    message,
    '🔎 Поиск пользователя\n\n' +
      'Отправь следующим сообщением имя, часть имени или телефон.\n\n' +
      'Например: «Иван», «29» или «37529».\n\n' +
      'Email в системе не хранится, поэтому поиск по нему недоступен.',
    {
      inline_keyboard: [
        [{ text: '⬅️ Назад', callback_data: 'admin:users' }],
        [homeButton()],
      ],
    },
  );
}

async function renderUsersSearchResults(
  admin: SupabaseClient,
  state: ConversationState,
  query: string,
): Promise<void> {
  const message = { chatId: state.chat_id, messageId: state.message_id };
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    await editAdminMessage(
      message,
      '🔎 Поиск пользователя\n\nЗапрос слишком короткий — введи минимум 2 символа.',
      {
        inline_keyboard: [
          [{ text: '⬅️ Назад', callback_data: 'admin:users' }],
          [homeButton()],
        ],
      },
    );
    return;
  }

  const members = await searchMembers(admin, trimmed);
  if (members.length === 0) {
    await editAdminMessage(
      message,
      `🔎 Никого не нашли по запросу «${trimmed}».\n\nПопробуй другое имя или телефон. Новый запрос — просто отправь его сообщением.`,
      {
        inline_keyboard: [
          [{ text: '⬅️ Назад', callback_data: 'admin:users' }],
          [homeButton()],
        ],
      },
    );
    return;
  }

  const text = [
    `🔎 Результаты по запросу «${trimmed}»: ${members.length}`,
    '',
    ...members.map((member, index) => `${index + 1}. ${memberCard(member)}`),
    '',
    'Нажми на пользователя, чтобы открыть профиль. Новый запрос — просто отправь его сообщением.',
  ].join('\n\n');

  const keyboard: InlineButton[][] = members.map((member) => [
    {
      text: `👤 ${shorten(memberDisplayName(member), 40)}`,
      // Контекст не передаём: «Назад» из профиля после поиска ведёт в меню.
      callback_data: `admin:user:${member.telegram_id}::`,
    },
  ]);
  keyboard.push([{ text: '⬅️ Назад', callback_data: 'admin:users' }], [homeButton()]);

  await editAdminMessage(message, text, { inline_keyboard: keyboard });
}

// Страница списка пользователей категории с пагинацией.
async function renderUserList(
  admin: SupabaseClient,
  message: AdminMessage,
  category: UserCategory,
  page: number,
): Promise<void> {
  const { members, total } = await listMembersInRoles(admin, category.roles, page, USERS_PER_PAGE);
  const pageCount = Math.max(1, Math.ceil(total / USERS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);

  const keyboard: InlineButton[][] = members.map((member) => [
    {
      text: `👤 ${shorten(memberDisplayName(member), 40)}`,
      callback_data: `admin:user:${member.telegram_id}::${category.id}:${safePage}`,
    },
  ]);

  if (pageCount > 1) {
    keyboard.push([
      {
        text: safePage > 0 ? '⬅️ Назад' : '·',
        callback_data: safePage > 0 ? `admin:cat:${category.id}:${safePage - 1}` : 'noop',
      },
      { text: `${safePage + 1}/${pageCount}`, callback_data: 'noop' },
      {
        text: safePage < pageCount - 1 ? '➡️ Далее' : '·',
        callback_data: safePage < pageCount - 1 ? `admin:cat:${category.id}:${safePage + 1}` : 'noop',
      },
    ]);
  }
  keyboard.push([{ text: '⬅️ К пользователям', callback_data: 'admin:users' }], [homeButton()]);

  const text =
    total === 0
      ? `${category.title}: пока никого нет.`
      : [
          `${category.title}: всего ${total}`,
          '',
          ...members.map((member, index) => `${safePage * USERS_PER_PAGE + index + 1}. ${memberCard(member)}`),
        ].join('\n\n');

  await editAdminMessage(message, text, { inline_keyboard: keyboard });
}

// Карточка пользователя. Поля без данных в системе помечены «нет данных»,
// чтобы не выдумывать сущности: таблиц оплат и занятий пока нет.
async function renderUserProfile(admin: SupabaseClient, message: AdminMessage, member: MemberRow): Promise<void> {
  let leads = 0;
  try {
    if (member.phone) leads = await countLeadsByPhone(admin, member.phone);
  } catch (error) {
    // Заявки — дополнительная информация; без них карточка остаётся работоспособной.
    console.error('Не удалось получить заявки пользователя:', error);
  }

  const lines = [
    `👤 ${memberDisplayName(member)}`,
    member.phone ? `📱 Телефон: ${member.phone}` : '📱 Телефон: не указан',
    `✈️ Telegram: ${member.chat_id ? 'подключён' : 'не подключён'}`,
    `🎭 Роль: ${roleLabel(member.role)}`,
    `📚 Доступ к курсу: ${member.role === 'student' ? 'есть' : 'нет'}`,
    '👨‍🏫 Индивидуальные занятия: нет данных (таблицы занятий нет)',
    '👥 Групповые занятия: нет данных (таблицы занятий нет)',
    '💳 Оплата: нет данных (таблицы оплат нет)',
  ];
  if (leads > 0) lines.push(`📝 Заявок с сайта: ${leads}`);

  await editAdminMessage(message, lines.join('\n'), {
    inline_keyboard: [
      [{ text: '🎭 Изменить роль', callback_data: `admin:user:${member.telegram_id}:role::` }],
      [homeButton()],
    ],
  });
}

async function renderRoleChoices(message: AdminMessage, member: MemberRow, callerId: number): Promise<void> {
  const roles: BotRole[] = isAdminEnv(callerId) ? [...ASSIGNABLE_ROLES, 'test'] : ASSIGNABLE_ROLES;
  const keyboard: InlineButton[][] = roles.map((role) => [
    {
      text: `${member.role === role ? '✅ ' : ''}${roleLabel(role)}`,
      callback_data: `admin:user:${member.telegram_id}:set:${role}::`,
    },
  ]);
  keyboard.push([{ text: '↩️ К профилю', callback_data: `admin:user:${member.telegram_id}::` }]);

  await editAdminMessage(
    message,
    `🎭 Выбери новую роль для «${memberDisplayName(member)}».\n\nТекущая роль: ${roleLabel(member.role)}.`,
    { inline_keyboard: keyboard },
  );
}

async function renderRoleConfirm(message: AdminMessage, member: MemberRow, role: BotRole): Promise<void> {
  await editAdminMessage(
    message,
    `Назначить роль «${roleLabel(role)}» пользователю ${memberDisplayName(member)}?`,
    {
      inline_keyboard: [
        [{ text: '✅ Подтвердить', callback_data: `admin:user:${member.telegram_id}:confirm:${role}::` }],
        [{ text: '↩️ Отмена', callback_data: `admin:user:${member.telegram_id}:role::` }],
      ],
    },
  );
}

async function applyRoleChange(
  admin: SupabaseClient,
  message: AdminMessage,
  member: MemberRow,
  role: BotRole,
  callerId: number,
): Promise<void> {
  if (role === 'test' && !isAdminEnv(callerId)) {
    await editAdminMessage(message, 'Роль test назначается только владельцу бота.', {
      inline_keyboard: [[{ text: '↩️ К профилю', callback_data: `admin:user:${member.telegram_id}::` }]],
    });
    return;
  }

  // setRole сам обновляет updated_at.
  const found = await setRole(admin, member.telegram_id, role);
  const text = found
    ? `✅ Роль «${roleLabel(role)}» установлена для ${memberDisplayName(member)}.`
    : 'Пользователь не найден — возможно, запись уже удалена.';
  await editAdminMessage(message, text, {
    inline_keyboard: [[{ text: '↩️ К профилю пользователя', callback_data: `admin:user:${member.telegram_id}::` }]],
  });
}

// Callback-кнопки панели: пользователи, категории, заглушки и возврат домой.
// Всегда возвращает true.
async function handlePanelAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  if (data === 'admin:home') {
    await clearStateIfAvailable(admin, telegramId);
    await showAdminHome(message);
    return true;
  }

  if (data === 'admin:users') {
    await renderUsersMenu(admin, telegramId, message);
    return true;
  }

  if (data === 'admin:users:search') {
    try {
      await renderUserSearchPrompt(admin, telegramId, message);
    } catch (error) {
      if (!isConversationStateTableError(error)) throw error;
      await editAdminMessage(message, migrationText('bot_conversation_states.sql'), homeOnlyKeyboard());
    }
    return true;
  }

  if (data === 'admin:stats' || data === 'admin:chat-control') {
    await editAdminMessage(message, STUB_SECTION_TEXT, homeOnlyKeyboard());
    return true;
  }

  // admin:cat:<категория>:<страница>
  if (data.startsWith('admin:cat:')) {
    const [, , categoryId, pageRaw] = data.split(':');
    const category = findCategory(categoryId);
    const page = Math.max(0, Number(pageRaw) || 0);
    if (category) await renderUserList(admin, message, category, page);
    else await renderUsersMenu(admin, telegramId, message);
    return true;
  }

  // admin:user:<telegram_id>:<действие>:<роль>:<категория>:<страница>
  // Части категории и страницы могут быть пустыми (поиск, профиль без контекста).
  const parts = data.split(':');
  const targetId = Number(parts[2]);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) {
    await showAdminHome(message);
    return true;
  }

  const member = await getMember(admin, targetId);
  if (!member) {
    await editAdminMessage(message, 'Пользователь не найден.', {
      inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'admin:users' }], [homeButton()]],
    });
    return true;
  }

  const action = parts[3] || '';
  const role = parts[4];
  const category = findCategory(parts[5] ?? '');
  const page = Math.max(0, Number(parts[6]) || 0);
  // «Назад»: в список категории либо в меню пользователей после поиска.
  const back = category
    ? { text: '⬅️ Назад', callback_data: `admin:cat:${category.id}:${page}` }
    : { text: '⬅️ Назад', callback_data: 'admin:users' };

  if (action === '' ) {
    await renderUserProfile(admin, message, member);
    return true;
  }

  if (action === 'role') {
    await renderRoleChoices(message, member, telegramId);
    return true;
  }

  if (!isBotRole(role)) {
    await renderUserProfile(admin, message, member);
    return true;
  }

  if (action === 'set') {
    await renderRoleConfirm(message, member, role);
    return true;
  }

  if (action === 'confirm') {
    await applyRoleChange(admin, message, member, role, telegramId);
    return true;
  }

  await editAdminMessage(message, memberCard(member), {
    inline_keyboard: [
      [{ text: '🎭 Изменить роль', callback_data: `admin:user:${member.telegram_id}:role::` }],
      [back],
      [homeButton()],
    ],
  });
  return true;
}

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

type BroadcastAttachmentKind = 'document' | 'photo';

// 4096 — лимит текста sendMessage, 1024 — лимит подписи к вложению.
const BROADCAST_TEXT_LIMIT = 4096;
const BROADCAST_CAPTION_LIMIT = 1024;
// ~20 сообщений/с: с запасом под лимит Bot API ~30 сообщ/с на бота.
const BROADCAST_DELAY_MS = 50;
// Пагинация Supabase: больше 1000 строк за запрос получить нельзя.
const BROADCAST_FETCH_PAGE = 1000;
// Детали храним ограниченно, чтобы не раздувать память на больших рассылках.
const BROADCAST_ERROR_CAP = 200;

function findBroadcastAudience(id: string | undefined): BroadcastAudience | undefined {
  if (!id) return undefined;
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

async function renderBroadcastAudienceMenu(message: AdminMessage): Promise<void> {
  const keyboard: InlineButton[][] = BROADCAST_AUDIENCES.map((audience) => [
    { text: audience.buttonLabel, callback_data: `admin:bc:aud:${audience.id}` },
  ]);
  keyboard.push([homeButton()]);
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

async function renderBroadcastComposer(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
): Promise<void> {
  const payload = state.payload ?? {};
  const audience = findBroadcastAudience(payload.audience);
  if (!audience || !payload.broadcastText) {
    await clearState(admin, telegramId);
    await renderBroadcastAudienceMenu({ chatId: state.chat_id, messageId: state.message_id });
    return;
  }

  const message = { chatId: state.chat_id, messageId: state.message_id };
  const lines = [
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

  await saveState(admin, telegramId, message, 'broadcast:compose', payload);
  await editAdminMessage(message, lines.join('\n'), {
    inline_keyboard: [
      [{ text: '📎 Прикрепить файл / фото', callback_data: 'admin:bc:attach' }],
      [{ text: '🔗 Добавить кнопку', callback_data: 'admin:bc:button' }],
      [{ text: '👁 Предпросмотр', callback_data: 'admin:bc:preview' }],
      [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
    ],
  });
}

async function renderBroadcastAttachPrompt(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
): Promise<void> {
  const payload = state.payload ?? {};
  if (payload.attachmentKind && payload.fileId) {
    await renderBroadcastComposer(admin, telegramId, state);
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

async function handleBroadcastAttachment(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  document: IncomingDocument,
): Promise<boolean> {
  const payload = state.payload ?? {};
  const message = { chatId: state.chat_id, messageId: state.message_id };
  const kind: BroadcastAttachmentKind = document.kind === 'photo' ? 'photo' : 'document';

  // Лимит подписи у сообщений с вложением строже, чем у обычного текста.
  if ((payload.broadcastText ?? '').length > BROADCAST_CAPTION_LIMIT) {
    await editAdminMessage(
      message,
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

  await saveState(admin, telegramId, message, 'broadcast:compose', {
    ...payload,
    attachmentKind: kind,
    fileId: document.fileId,
    fileName: document.fileName,
  });
  await renderBroadcastComposer(admin, telegramId, {
    ...state,
    step: 'broadcast:compose',
    payload: { ...payload, attachmentKind: kind, fileId: document.fileId, fileName: document.fileName },
  });
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

async function renderBroadcastButtonUrl(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
): Promise<void> {
  const message = { chatId: state.chat_id, messageId: state.message_id };
  await saveState(admin, telegramId, message, 'broadcast:button-url', state.payload ?? {});
  await editAdminMessage(message, '🔗 Теперь отправьте URL кнопки.\n\nНапример: https://example.com/webinar', {
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

async function renderBroadcastStats(message: AdminMessage, line: string, hasErrors: boolean): Promise<void> {
  const keyboard: InlineButton[][] = [];
  if (hasErrors) keyboard.push([{ text: '📋 Ошибки', callback_data: 'admin:bc:errors' }]);
  keyboard.push([homeButton()]);
  await editAdminMessage(message, `📢 Рассылка завершена\n\n${line}`, { inline_keyboard: keyboard });
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
  // Состояние рассылки очищаем, но статистику и первые ошибки сохраняем
  // до выхода домой, чтобы кнопка «📋 Ошибки» работала после отправки.
  await saveState(admin, telegramId, message, 'broadcast:stats', {
    statsLine,
    broadcastErrors: errors.slice(0, 20).map((item) => `${item.name} — ${item.reason}`),
  });
  await renderBroadcastStats(message, statsLine, errors.length > 0);

  if (errors.length > 0) {
    console.error('Ошибки рассылки:', errors.slice(0, 20));
  }
}

async function renderBroadcastErrors(admin: SupabaseClient, telegramId: number, message: AdminMessage): Promise<void> {
  let state: ConversationState | null = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
  const payload = state?.payload ?? {};
  if (!payload.statsLine) {
    await showAdminHome(message);
    return;
  }
  const errors = payload.broadcastErrors ?? [];
  const text = [
    '📋 Недоставленные сообщения:',
    '',
    errors.length > 0
      ? errors.map((line, index) => `${index + 1}. ${line}`).join('\n')
      : 'Список пуст.',
  ];
  if (errors.length >= 20) text.push('', 'Показаны первые 20 ошибок; полный список — в серверных логах.');
  await editAdminMessage(message, text.join('\n'), {
    inline_keyboard: [
      [{ text: '↩️ К статистике', callback_data: 'admin:bc:stats' }],
      [homeButton()],
    ],
  });
}

async function renderBroadcastStatsFromState(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
): Promise<void> {
  let state: ConversationState | null = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }
  const statsLine = state?.payload?.statsLine;
  if (!statsLine) {
    await showAdminHome(message);
    return;
  }
  await renderBroadcastStats(message, statsLine, true);
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
async function handleBroadcastTextStep(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  text: string,
): Promise<boolean> {
  const payload = state.payload ?? {};
  const message = { chatId: state.chat_id, messageId: state.message_id };
  const input = text.trim();

  if (state.step === 'broadcast:text') {
    if (!input) return true;
    if (input.length > BROADCAST_TEXT_LIMIT) {
      await editAdminMessage(
        message,
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
    await saveState(admin, telegramId, message, 'broadcast:compose', { ...payload, broadcastText: input });
    await renderBroadcastComposer(admin, telegramId, {
      ...state,
      step: 'broadcast:compose',
      payload: { ...payload, broadcastText: input },
    });
    return true;
  }

  if (state.step === 'broadcast:button-text') {
    if (!input) return true;
    await saveState(admin, telegramId, message, 'broadcast:button-url', { ...payload, buttonText: shorten(input, 40) });
    await renderBroadcastButtonUrl(admin, telegramId, {
      ...state,
      step: 'broadcast:button-url',
      payload: { ...payload, buttonText: shorten(input, 40) },
    });
    return true;
  }

  if (state.step === 'broadcast:button-url') {
    if (!isValidHttpUrl(input)) {
      await editAdminMessage(message, '⚠️ Это не похоже на ссылку. Отправьте URL вида https://example.com', {
        inline_keyboard: [
          [{ text: '↩️ Назад', callback_data: 'admin:bc:menu' }],
          [{ text: '❌ Отмена', callback_data: 'admin:bc:cancel' }],
        ],
      });
      return true;
    }
    await saveState(admin, telegramId, message, 'broadcast:compose', { ...payload, buttonUrl: input });
    await renderBroadcastComposer(admin, telegramId, {
      ...state,
      step: 'broadcast:compose',
      payload: { ...payload, buttonUrl: input },
    });
    return true;
  }

  return false;
}

// Callback-кнопки рассылки (admin:broadcasts и admin:bc:*). Всегда возвращает true.
async function handleBroadcastAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  if (data === 'admin:broadcasts') {
    await clearStateIfAvailable(admin, telegramId);
    await renderBroadcastAudienceMenu(message);
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
    if (!selected) {
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
    await renderBroadcastAudienceMenu(message);
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
      await renderBroadcastComposer(admin, telegramId, state);
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
    case 'stats':
      await renderBroadcastStatsFromState(admin, telegramId, message);
      return true;
    case 'errors':
      await renderBroadcastErrors(admin, telegramId, message);
      return true;
    default:
      await renderBroadcastComposer(admin, telegramId, state);
      return true;
  }
}

// ---------------------------------------------------------------------------
// Единые точки входа для webhook
// ---------------------------------------------------------------------------

// Обрабатывает inline-кнопки админа: admin:*, ar:* и an:*.
// Роль повторно проверяется по БД, ответ на callback отправляется всегда.
export async function handleAdminCallback(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  const isReminder = data.startsWith('ar:');
  const isTemplate = data.startsWith('an:');
  const isWebinar = data.startsWith('admin:');
  if (!isReminder && !isTemplate && !isWebinar) return false;

  const acknowledge = async (text?: string, showAlert = false) => {
    if (callbackQueryId) {
      await telegramSend('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      });
    }
  };

  if (!(await isAdmin(admin, telegramId))) {
    await acknowledge('Недостаточно прав.', true);
    return true;
  }
  await acknowledge();

  try {
    if (isReminder) return await handleReminderAction(admin, data, message, telegramId);
    if (isTemplate) return await handleTemplateAction(admin, data, message, telegramId);
    if (data === 'admin:broadcasts' || data.startsWith('admin:bc:')) {
      return await handleBroadcastAction(admin, data, message, telegramId);
    }
    if (isPanelAction(data)) return await handlePanelAction(admin, data, message, telegramId);
    return await handleWebinarAction(admin, data, message, telegramId);
  } catch (error) {
    if (isTemplateTableError(error)) {
      await renderTemplateMigrationMessage(message);
      return true;
    }
    throw error;
  }
}

// Текстовые ответы админа: шаги мастера вебинаров и настройка шаблонов.
export async function handleAdminMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  if (!(await isAdmin(admin, telegramId))) return false;

  let state: ConversationState | null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (isConversationStateTableError(error)) return false;
    throw error;
  }
  if (!state || state.chat_id !== chatId) return false;

  // Поиск пользователей: шаг остаётся активным, пока админ не уйдёт домой.
  if (state.step === 'users:search') {
    await renderUsersSearchResults(admin, state, text);
    return true;
  }

  // Шаги конструктора рассылки, ожидающие текст.
  if (state.step === 'broadcast:text' || state.step === 'broadcast:button-text' || state.step === 'broadcast:button-url') {
    return handleBroadcastTextStep(admin, telegramId, state, text);
  }

  if (state.step.startsWith('notification:')) {
    return handleNotificationTextStep(admin, telegramId, state, text);
  }

  const input = text.trim();
  if (state.step.startsWith('create:')) {
    await renderCreationStep(admin, telegramId, state, input);
    return true;
  }
  if (state.step.startsWith('edit:')) {
    await renderExistingEditStep(admin, telegramId, state, input);
    return true;
  }

  // Неизвестный шаг — очищаем устаревшее состояние.
  await clearState(admin, telegramId);
  return false;
}

// Документы и фото админа: вложение для шаблона уведомления
// или вложение для рассылки после нажатия «Прикрепить файл / фото».
export async function handleAdminDocument(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  document: IncomingDocument,
): Promise<boolean> {
  if (!(await isAdmin(admin, telegramId))) return false;

  let state: ConversationState | null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (isConversationStateTableError(error)) return false;
    throw error;
  }
  if (!state || state.chat_id !== chatId) return false;

  // Вложение рассылки: файл или фото, отправленные на шаге конструктора.
  if (state.step.startsWith('broadcast:')) {
    return handleBroadcastAttachment(admin, telegramId, state, document);
  }

  if (state.step !== 'notification:file') return false;

  const payload = state.payload ?? {};
  const webinarId = payload.webinarId;
  const reminderType = payload.reminderType;
  if (!webinarId || !reminderType || !isReminderType(reminderType)) {
    await clearState(admin, telegramId);
    return false;
  }

  const message = { chatId: state.chat_id, messageId: state.message_id };
  try {
    await saveWebinarNotificationTemplate(admin, {
      webinarId,
      reminderType,
      fileId: document.fileId,
      fileType: document.mimeType ?? document.fileName ?? 'document',
    });
    await clearState(admin, telegramId);
    await renderTemplateDetail(admin, message, webinarId, reminderType);
    return true;
  } catch (error) {
    if (isTemplateTableError(error)) {
      await renderTemplateMigrationMessage(message);
      return true;
    }
    throw error;
  }
}
