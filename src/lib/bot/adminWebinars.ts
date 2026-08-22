import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { adminReminderMenuButton } from '@/lib/bot/adminReminderTests';
import { adminNotificationTemplatesMenuButton } from '@/lib/bot/adminNotificationTemplates';

export const ADMIN_WEBINAR_CALLBACKS = {
  home: 'admin:home',
  menu: 'admin:webinars',
  create: 'admin:webinar:create',
  createConfirm: 'admin:webinar:create:confirm',
  createEdit: 'admin:webinar:create:edit',
  createCancel: 'admin:webinar:create:cancel',
  list: 'admin:webinar:list',
} as const;

type AdminMessage = {
  chatId: number;
  messageId: number;
};

type InlineKeyboard = {
  inline_keyboard: Array<Array<Record<string, string>>>;
};

type Webinar = {
  id: string | number;
  title: string;
  description: string | null;
  webinar_date: string;
  registration_url: string | null;
  is_active: boolean;
};

type Draft = {
  title?: string;
  description?: string | null;
  webinar_date?: string;
  registration_url?: string | null;
  webinarId?: string | number;
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
  | 'edit:url';

type ConversationState = {
  telegram_id: number;
  chat_id: number;
  message_id: number;
  step: ConversationStep;
  payload: Draft;
};

const ADMIN_HOME_TEXT =
  '👋 Привет! Ты админ бота District.\n\n' +
  'Управляй вебинарами через кнопку ниже или используй служебные команды.';

function adminHomeKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: '📅 Вебинары', callback_data: ADMIN_WEBINAR_CALLBACKS.menu }],
      [adminReminderMenuButton()],
      [adminNotificationTemplatesMenuButton()],
    ],
  };
}

function managementKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: '➕ Создать вебинар', callback_data: ADMIN_WEBINAR_CALLBACKS.create }],
      [{ text: '📋 Все вебинары', callback_data: ADMIN_WEBINAR_CALLBACKS.list }],
      [{ text: '🏠 Главное меню', callback_data: ADMIN_WEBINAR_CALLBACKS.home }],
    ],
  };
}

function managementButton() {
  return { text: '↩️ К управлению вебинарами', callback_data: ADMIN_WEBINAR_CALLBACKS.menu };
}

function homeButton() {
  return { text: '🏠 Главное меню', callback_data: ADMIN_WEBINAR_CALLBACKS.home };
}

function callback(...parts: Array<string | number>): string {
  return ['admin', 'webinar', ...parts.map(String)].join(':');
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

  if (!result.ok && !result.description?.includes('message is not modified')) {
    throw new Error(result.description ?? 'Не удалось обновить административное сообщение.');
  }
}

async function renderConversationStateMigrationMessage(message: AdminMessage): Promise<void> {
  await editAdminMessage(
    message,
    '⚠️ Для создания и редактирования вебинаров нужно применить SQL-миграцию `supabase/bot_conversation_states.sql` в Supabase SQL Editor.',
    { inline_keyboard: [[managementButton()], [homeButton()]] },
  );
}

async function getMemberRole(admin: SupabaseClient, telegramId: number): Promise<string | null> {
  const { data, error } = await admin
    .from('bot_members')
    .select('role')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  return typeof data?.role === 'string' ? data.role : null;
}

async function isAdmin(admin: SupabaseClient, telegramId: number): Promise<boolean> {
  return (await getMemberRole(admin, telegramId)) === 'admin';
}

function isConversationStateTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  return (
    code === '42P01' ||
    message.includes('bot_conversation_states') ||
    (message.includes('relation') && message.includes('does not exist'))
  );
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
  payload: Draft,
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

async function clearStateIfAvailable(admin: SupabaseClient, telegramId: number): Promise<void> {
  try {
    await clearState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    console.error('Таблица состояния диалогов не применена:', error);
  }
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

function createPreviewText(draft: Draft): string {
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
    await editAdminMessage(message, 'Вебинар не найден или уже удалён.', {
      inline_keyboard: [[managementButton()], [homeButton()]],
    });
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
      [{ text: '✏️ Изменить', callback_data: callback('view', webinar.id, 'edit') }],
      [
        {
          text: webinar.is_active ? '🔴 Деактивировать' : '🟢 Активировать',
          callback_data: callback('view', webinar.id, 'toggle'),
        },
      ],
      [{ text: '🗑 Удалить', callback_data: callback('view', webinar.id, 'delete') }],
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
      inline_keyboard: [[{ text: '➕ Создать вебинар', callback_data: ADMIN_WEBINAR_CALLBACKS.create }], [managementButton()]],
    });
    return;
  }

  const text = ['📋 Все вебинары', '', ...webinars.map((webinar, index) => (
    `${index + 1}. ${webinar.title}\n${formatWebinarDate(webinar.webinar_date)} · ${webinarStatus(webinar)}`
  ))].join('\n\n');
  const buttons: Array<Array<Record<string, string>>> = [];
  for (const webinar of webinars) {
    buttons.push([{ text: `📅 ${webinar.title}`, callback_data: callback('view', webinar.id, 'open') }]);
    buttons.push([
      { text: '✏️ Изменить', callback_data: callback('view', webinar.id, 'edit') },
      {
        text: webinar.is_active ? '🔴 Деактивировать' : '🟢 Активировать',
        callback_data: callback('view', webinar.id, 'toggle'),
      },
    ]);
    buttons.push([{ text: '🗑 Удалить', callback_data: callback('view', webinar.id, 'delete') }]);
  }
  buttons.push([managementButton()], [homeButton()]);

  await editAdminMessage(message, text, { inline_keyboard: buttons });
}

async function renderCreateEditChoices(message: AdminMessage): Promise<void> {
  await editAdminMessage(message, '✏️ Что изменить в черновике вебинара?', {
    inline_keyboard: [
      [{ text: 'Название', callback_data: callback('create', 'field', 'title') }],
      [{ text: 'Описание', callback_data: callback('create', 'field', 'description') }],
      [{ text: 'Дата и время', callback_data: callback('create', 'field', 'date') }],
      [{ text: 'Ссылка на регистрацию', callback_data: callback('create', 'field', 'url') }],
      [{ text: '↩️ К предпросмотру', callback_data: callback('create', 'preview') }],
      [{ text: '❌ Отмена', callback_data: ADMIN_WEBINAR_CALLBACKS.createCancel }],
    ],
  });
}

async function renderEditChoices(message: AdminMessage, webinarId: string): Promise<void> {
  await editAdminMessage(message, '✏️ Что изменить в вебинаре?', {
    inline_keyboard: [
      [{ text: 'Название', callback_data: callback('view', webinarId, 'field', 'title') }],
      [{ text: 'Описание', callback_data: callback('view', webinarId, 'field', 'description') }],
      [{ text: 'Дата и время', callback_data: callback('view', webinarId, 'field', 'date') }],
      [{ text: 'Ссылка на регистрацию', callback_data: callback('view', webinarId, 'field', 'url') }],
      [{ text: '↩️ Назад к вебинару', callback_data: callback('view', webinarId, 'open') }],
    ],
  });
}

async function renderDeleteConfirm(message: AdminMessage, webinarId: string): Promise<void> {
  await editAdminMessage(message, '⚠️ Вы уверены, что хотите удалить этот вебинар?', {
    inline_keyboard: [
      [{ text: '❌ Да, удалить', callback_data: callback('view', webinarId, 'delete-confirm') }],
      [{ text: '↩️ Отмена', callback_data: callback('view', webinarId, 'open') }],
    ],
  });
}

async function showCreatePreview(
  admin: SupabaseClient,
  telegramId: number,
  message: AdminMessage,
  draft: Draft,
): Promise<void> {
  await saveState(admin, telegramId, message, 'create:preview', draft);
  await editAdminMessage(message, createPreviewText(draft), previewKeyboard());
}

async function startCreate(admin: SupabaseClient, telegramId: number, message: AdminMessage): Promise<void> {
  await saveState(admin, telegramId, message, 'create:title', {});
  await editAdminMessage(message, 'Введите название вебинара:', {
    inline_keyboard: [[{ text: '❌ Отмена', callback_data: ADMIN_WEBINAR_CALLBACKS.createCancel }]],
  });
}

async function showAdminHome(message: AdminMessage): Promise<void> {
  await editAdminMessage(message, ADMIN_HOME_TEXT, adminHomeKeyboard());
}

async function renderCreationStep(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  input: string,
): Promise<void> {
  const message = { chatId: state.chat_id, messageId: state.message_id };
  const payload = { ...(state.payload ?? {}) } as Draft;

  if (state.step === 'create:title' || state.step === 'create:edit:title') {
    if (!input) {
      await editAdminMessage(message, 'Название не может быть пустым. Введите название вебинара:', {
        inline_keyboard: [[{ text: '❌ Отмена', callback_data: ADMIN_WEBINAR_CALLBACKS.createCancel }]],
      });
      return;
    }
    payload.title = input;
    if (state.step === 'create:edit:title') {
      await showCreatePreview(admin, telegramId, message, payload);
    } else {
      await saveState(admin, telegramId, message, 'create:description', payload);
      await editAdminMessage(message, 'Введите описание вебинара. Отправьте «-», если описание не нужно:', {
        inline_keyboard: [[{ text: '❌ Отмена', callback_data: ADMIN_WEBINAR_CALLBACKS.createCancel }]],
      });
    }
    return;
  }

  if (state.step === 'create:description' || state.step === 'create:edit:description') {
    payload.description = normalizeOptional(input);
    if (state.step === 'create:edit:description') {
      await showCreatePreview(admin, telegramId, message, payload);
    } else {
      await saveState(admin, telegramId, message, 'create:date', payload);
      await editAdminMessage(message, 'Введите дату и время вебинара в формате:\n15.09.2026 19:00', {
        inline_keyboard: [[{ text: '❌ Отмена', callback_data: ADMIN_WEBINAR_CALLBACKS.createCancel }]],
      });
    }
    return;
  }

  if (state.step === 'create:date' || state.step === 'create:edit:date') {
    const date = parseWebinarDate(input);
    if (!date) {
      await editAdminMessage(message, 'Неверный формат. Введите дату и время так:\n15.09.2026 19:00', {
        inline_keyboard: [[{ text: '❌ Отмена', callback_data: ADMIN_WEBINAR_CALLBACKS.createCancel }]],
      });
      return;
    }
    payload.webinar_date = date;
    if (state.step === 'create:edit:date') {
      await showCreatePreview(admin, telegramId, message, payload);
    } else {
      await saveState(admin, telegramId, message, 'create:url', payload);
      await editAdminMessage(message, 'Введите ссылку на регистрацию. Отправьте «-», если ссылка не нужна:', {
        inline_keyboard: [[{ text: '❌ Отмена', callback_data: ADMIN_WEBINAR_CALLBACKS.createCancel }]],
      });
    }
    return;
  }

  if (state.step === 'create:url' || state.step === 'create:edit:url') {
    const url = normalizeOptional(input);
    if (url) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
      } catch {
        await editAdminMessage(message, 'Укажите корректную ссылку с http:// или https://, либо отправьте «-».', {
          inline_keyboard: [[{ text: '❌ Отмена', callback_data: ADMIN_WEBINAR_CALLBACKS.createCancel }]],
        });
        return;
      }
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
      await editAdminMessage(message, 'Название не может быть пустым. Введите название вебинара:', {
        inline_keyboard: [[{ text: '↩️ Отмена', callback_data: callback('view', webinarId, 'open') }]],
      });
      return;
    }
    patch = { title: input };
  }
  if (state.step === 'edit:description') patch = { description: normalizeOptional(input) };
  if (state.step === 'edit:date') {
    const date = parseWebinarDate(input);
    if (!date) {
      await editAdminMessage(message, 'Неверный формат. Введите дату и время так:\n15.09.2026 19:00', {
        inline_keyboard: [[{ text: '↩️ Отмена', callback_data: callback('view', webinarId, 'open') }]],
      });
      return;
    }
    patch = { webinar_date: date };
  }
  if (state.step === 'edit:url') {
    const url = normalizeOptional(input);
    if (url) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
      } catch {
        await editAdminMessage(message, 'Укажите корректную ссылку с http:// или https://, либо отправьте «-».', {
          inline_keyboard: [[{ text: '↩️ Отмена', callback_data: callback('view', webinarId, 'open') }]],
        });
        return;
      }
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

// Обрабатывает текстовые ответы для пошагового создания и редактирования.
export async function handleAdminWebinarMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  let state: ConversationState | null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (isConversationStateTableError(error)) return false;
    throw error;
  }
  if (!state || state.chat_id !== chatId) return false;

  if (!(await isAdmin(admin, telegramId))) {
    await clearState(admin, telegramId);
    return false;
  }

  const input = text.trim();
  if (state.step.startsWith('create:')) {
    await renderCreationStep(admin, telegramId, state, input);
  } else {
    await renderExistingEditStep(admin, telegramId, state, input);
  }
  return true;
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
  if (
    state?.step !== 'create:preview' ||
    !draft.title ||
    !draft.webinar_date
  ) {
    await editAdminMessage(message, 'Черновик вебинара не найден. Начните создание заново.', {
      inline_keyboard: [[{ text: '➕ Создать вебинар', callback_data: ADMIN_WEBINAR_CALLBACKS.create }], [managementButton()]],
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
      { inline_keyboard: [[managementButton()], [homeButton()]] },
    );
    return;
  }

  const { error } = await admin.from('webinars').delete().eq('id', webinarId);
  if (error) {
    if (error.code === '23503') {
      await editAdminMessage(message, 'Нельзя удалить вебинар из-за связанных данных. Данные сохранены.', {
        inline_keyboard: [[managementButton()], [homeButton()]],
      });
      return;
    }
    throw error;
  }

  await editAdminMessage(message, '✅ Вебинар удалён.', {
    inline_keyboard: [[managementButton()], [homeButton()]],
  });
}

// Обрабатывает только callback_data с префиксом admin: и повторно проверяет роль в БД.
export async function handleAdminWebinarCallback(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
  callbackQueryId?: string,
): Promise<boolean> {
  if (!data.startsWith('admin:')) return false;

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

  if (data === ADMIN_WEBINAR_CALLBACKS.home) {
    // Возврат в меню не должен ломаться, даже если миграция состояния ещё не применена.
    await clearStateIfAvailable(admin, telegramId);
    await showAdminHome(message);
    return true;
  }

  if (data === ADMIN_WEBINAR_CALLBACKS.menu) {
    // Само меню не зависит от состояния диалога и должно открываться даже до применения миграции.
    await editAdminMessage(message, '📅 Управление вебинарами', managementKeyboard());
    return true;
  }

  if (data === ADMIN_WEBINAR_CALLBACKS.create) {
    try {
      await startCreate(admin, telegramId, message);
    } catch (error) {
      console.error('Не удалось начать создание вебинара:', error);
      if (isConversationStateTableError(error)) {
        await renderConversationStateMigrationMessage(message);
      } else {
        await editAdminMessage(message, '⚠️ Не удалось открыть создание вебинара. Проверьте подключение к Supabase и повторите попытку.', {
          inline_keyboard: [[managementButton()], [homeButton()]],
        });
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

  if (data === callback('create', 'preview')) {
    const state = await getState(admin, telegramId);
    if (state?.step === 'create:preview') await editAdminMessage(message, createPreviewText(state.payload), previewKeyboard());
    return true;
  }

  if (data === ADMIN_WEBINAR_CALLBACKS.createConfirm) {
    await createWebinarFromDraft(admin, telegramId, message);
    return true;
  }

  if (data.startsWith(callback('create', 'field'))) {
    const field = data.split(':').at(-1);
    const state = await getState(admin, telegramId);
    if (!state?.payload) return true;

    const stepMap: Record<string, ConversationStep> = {
      title: 'create:edit:title',
      description: 'create:edit:description',
      date: 'create:edit:date',
      url: 'create:edit:url',
    };
    const prompts: Record<string, string> = {
      title: 'Введите новое название вебинара:',
      description: 'Введите новое описание. Отправьте «-», если описание не нужно:',
      date: 'Введите новую дату и время в формате:\n15.09.2026 19:00',
      url: 'Введите новую ссылку на регистрацию. Отправьте «-», если ссылка не нужна:',
    };
    if (!field || !stepMap[field]) return true;

    await saveState(admin, telegramId, message, stepMap[field], state.payload);
    await editAdminMessage(message, prompts[field], {
      inline_keyboard: [[{ text: '↩️ К предпросмотру', callback_data: callback('create', 'preview') }]],
    });
    return true;
  }

  if (data === ADMIN_WEBINAR_CALLBACKS.list) {
    await renderWebinarList(admin, message);
    return true;
  }

  const view = parseViewCallback(data);
  if (!view) return true;

  if (view.action === 'open') {
    await renderWebinarDetail(admin, message, view.webinarId);
    return true;
  }

  if (view.action === 'edit') {
    await renderEditChoices(message, view.webinarId);
    return true;
  }

  if (view.action === 'field' && view.field) {
    const stepMap: Record<string, ConversationStep> = {
      title: 'edit:title',
      description: 'edit:description',
      date: 'edit:date',
      url: 'edit:url',
    };
    const prompts: Record<string, string> = {
      title: 'Введите новое название вебинара:',
      description: 'Введите новое описание. Отправьте «-», если описание не нужно:',
      date: 'Введите новую дату и время в формате:\n15.09.2026 19:00',
      url: 'Введите новую ссылку на регистрацию. Отправьте «-», если ссылка не нужна:',
    };
    if (!stepMap[view.field]) return true;

    await saveState(admin, telegramId, message, stepMap[view.field], { webinarId: view.webinarId });
    await editAdminMessage(message, prompts[view.field], {
      inline_keyboard: [[{ text: '↩️ Отмена', callback_data: callback('view', view.webinarId, 'open') }]],
    });
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

  return true;
}

// Отправляет начальный экран роли admin после /start.
export async function sendAdminStart(chatId: number, testFooter = ''): Promise<void> {
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: ADMIN_HOME_TEXT + testFooter,
    reply_markup: adminHomeKeyboard(),
  });
}
