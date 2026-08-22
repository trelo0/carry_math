import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type AdminMessage,
  type AdminPayload,
  type ConversationState,
  type ConversationStep,
  type InlineButton,
  type InlineKeyboard,
  type Webinar,
  clearState,
  clearStateIfAvailable,
  editAdminMessage,
  editDeliver,
  getState,
  homeButton,
  isConversationStateTableError,
  isValidHttpUrl,
  migrationText,
  saveState,
  sendAdminMessage,
  showAdminHome,
} from './core';

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

export function managementKeyboard(): InlineKeyboard {
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

// Предпросмотр — результат текстового ввода: новое сообщение ниже ввода.
async function showCreatePreview(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  draft: AdminPayload,
): Promise<void> {
  const messageId = await sendAdminMessage(chatId, createPreviewText(draft), previewKeyboard());
  await saveState(admin, telegramId, { chatId, messageId: messageId ?? 0 }, 'create:preview', draft);
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

// Ответ на каждый шаг мастера — новое сообщение: админ ввёл текст,
// следующий шаг появляется сразу под его сообщением.
export async function renderCreationStep(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  input: string,
): Promise<void> {
  const chatId = state.chat_id;
  const payload = { ...(state.payload ?? {}) } as AdminPayload;
  const isFieldEdit = state.step.startsWith('create:edit:');

  if (state.step === 'create:title' || state.step === 'create:edit:title') {
    if (!input) {
      await sendAdminMessage(chatId, 'Название не может быть пустым. Введите название вебинара:', createCancelKeyboard());
      return;
    }
    payload.title = input;
    if (isFieldEdit) {
      await showCreatePreview(admin, telegramId, chatId, payload);
    } else {
      const messageId = await sendAdminMessage(chatId, 'Введите описание вебинара. Отправьте «-», если описание не нужно:', createCancelKeyboard());
      await saveState(admin, telegramId, { chatId, messageId: messageId ?? 0 }, 'create:description', payload);
    }
    return;
  }

  if (state.step === 'create:description' || state.step === 'create:edit:description') {
    payload.description = normalizeOptional(input);
    if (isFieldEdit) {
      await showCreatePreview(admin, telegramId, chatId, payload);
    } else {
      const messageId = await sendAdminMessage(chatId, 'Введите дату и время вебинара в формате:\n15.09.2026 19:00', createCancelKeyboard());
      await saveState(admin, telegramId, { chatId, messageId: messageId ?? 0 }, 'create:date', payload);
    }
    return;
  }

  if (state.step === 'create:date' || state.step === 'create:edit:date') {
    const date = parseWebinarDate(input);
    if (!date) {
      await sendAdminMessage(chatId, 'Неверный формат. Введите дату и время так:\n15.09.2026 19:00', createCancelKeyboard());
      return;
    }
    payload.webinar_date = date;
    if (isFieldEdit) {
      await showCreatePreview(admin, telegramId, chatId, payload);
    } else {
      const messageId = await sendAdminMessage(chatId, 'Введите ссылку на регистрацию. Отправьте «-», если ссылка не нужна:', createCancelKeyboard());
      await saveState(admin, telegramId, { chatId, messageId: messageId ?? 0 }, 'create:url', payload);
    }
    return;
  }

  if (state.step === 'create:url' || state.step === 'create:edit:url') {
    const url = normalizeOptional(input);
    if (url && !isValidHttpUrl(url)) {
      await sendAdminMessage(chatId, 'Укажите корректную ссылку с http:// или https://, либо отправьте «-».', createCancelKeyboard());
      return;
    }
    payload.registration_url = url;
    await showCreatePreview(admin, telegramId, chatId, payload);
  }
}

export async function renderExistingEditStep(
  admin: SupabaseClient,
  telegramId: number,
  state: ConversationState,
  input: string,
): Promise<void> {
  const chatId = state.chat_id;
  const webinarId = String(state.payload?.webinarId ?? '');
  if (!webinarId) {
    await clearState(admin, telegramId);
    await sendAdminMessage(chatId, 'Состояние редактирования устарело. Откройте вебинар заново.', {
      inline_keyboard: [[managementButton()]],
    });
    return;
  }

  let patch: Record<string, string | null> | null = null;
  if (state.step === 'edit:title') {
    if (!input) {
      await sendAdminMessage(chatId, 'Название не может быть пустым. Введите название вебинара:', backToWebinarKeyboard(webinarId));
      return;
    }
    patch = { title: input };
  }
  if (state.step === 'edit:description') patch = { description: normalizeOptional(input) };
  if (state.step === 'edit:date') {
    const date = parseWebinarDate(input);
    if (!date) {
      await sendAdminMessage(chatId, 'Неверный формат. Введите дату и время так:\n15.09.2026 19:00', backToWebinarKeyboard(webinarId));
      return;
    }
    patch = { webinar_date: date };
  }
  if (state.step === 'edit:url') {
    const url = normalizeOptional(input);
    if (url && !isValidHttpUrl(url)) {
      await sendAdminMessage(chatId, 'Укажите корректную ссылку с http:// или https://, либо отправьте «-».', backToWebinarKeyboard(webinarId));
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
  // Результат ввода — новое сообщение под текстом админа.
  const webinar = await getWebinar(admin, webinarId);
  if (!webinar) {
    await sendAdminMessage(chatId, '✅ Вебинар обновлён.', { inline_keyboard: [[managementButton()]] });
    return;
  }
  await sendAdminMessage(
    chatId,
    [
      '✅ Вебинар обновлён.',
      '',
      `📅 ${webinar.title}`,
      '',
      `Описание: ${webinar.description ?? '—'}`,
      `Дата: ${formatWebinarDate(webinar.webinar_date)}`,
      `Ссылка: ${webinar.registration_url ?? '—'}`,
      `Статус: ${webinarStatus(webinar)}`,
    ].join('\n'),
    {
      inline_keyboard: [
        [{ text: '✏️ Изменить', callback_data: webinarCallback('view', webinar.id, 'edit') }],
        [
          {
            text: webinar.is_active ? '🔴 Деактивировать' : '🟢 Активировать',
            callback_data: webinarCallback('view', webinar.id, 'toggle'),
          },
        ],
        [managementButton()],
        [homeButton()],
      ],
    },
  );
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
export async function handleWebinarAction(
  admin: SupabaseClient,
  data: string,
  message: AdminMessage,
  telegramId: number,
): Promise<boolean> {
  if (data === ADMIN_WEBINAR_CALLBACKS.menu) {
    await editDeliver(message)('📅 Управление вебинарами', managementKeyboard());
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
