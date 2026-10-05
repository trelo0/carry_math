import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { isReminderType, saveWebinarNotificationTemplate } from '@/lib/webinarReminders';
import {
  type AdminMessage,
  type ConversationState,
  type IncomingDocument,
  ADMIN_HOME_TEXT,
  ADMIN_REPLY_LABELS,
  ADMIN_REPLY_LABEL_SET,
  ADMIN_UNKNOWN_TEXT,
  adminReplyKeyboard,
  clearState,
  clearStateIfAvailable,
  getState,
  isAdmin,
  isConversationStateTableError,
  isTemplateTableError,
  sendAdminMessage,
  sendDeliver,
} from './core';
import { renderUsersMenu, renderUsersSearchResults, isPanelAction, handlePanelAction } from './users';
import { renderModerationMenu, renderModerationSearchResults, handleModerationAction } from './moderation';
import { renderStatsOverview } from './stats';
import {
  renderBroadcastMenu,
  handleBroadcastAction,
  handleBroadcastAttachment,
  handleBroadcastTextStep,
} from './broadcasts';
import { managementKeyboard, handleWebinarAction, renderCreationStep, renderExistingEditStep } from './webinars';
import {
  handleReminderAction,
  handleTemplateAction,
  handleNotificationTextStep,
  renderTemplateDetail,
  renderTemplateMigrationMessage,
} from './settings';
import { renderLeadsMenu, handleLeadsAction, isLeadsAction } from './leads';
import { renderPurchasesMenu, handlePurchasesAction, isPurchasesAction } from './purchases';
import { handlePackagesAction, isPackagesAction } from './packages-menu';
import { handleAdminComposeMessageStep } from './comms-ops';
import {
  handleEducationAction,
  handleEducationTextStep,
  isEducationAction,
  renderEducationMenu,
} from './education-ops';
import { shouldAdminDeferTextToMaskedUi } from './admin-access';
import { renderAdminHomeDashboard, handleHubAction, isHubAction } from './home';
import { renderPeopleMenu } from './people-menu';
import { renderMoreMenu } from './more-menu';
import { renderFinanceMenu } from './finance-menu';
import { ADMIN_LEGACY_REPLY_LABELS } from './core';

// Единый сценарий админа: главное меню, пользователи, рассылки, статистика,
// контроль переписки, управление вебинарами, шаблоны уведомлений и тестовые
// отправки. Модуль — тонкий роутер; разделы лежат в соседних файлах.
// Префиксы callback_data (admin:, ar:, an:) сохранены без изменений:
// кнопки в старых чатах должны продолжать работать.

// ---------------------------------------------------------------------------
// Главное меню и открытие разделов
// ---------------------------------------------------------------------------

// Отправляет начальный экран роли admin после /start: текст + Reply Keyboard.
export async function sendAdminStart(
  chatId: number,
  testFooter = '',
  admin?: SupabaseClient,
): Promise<void> {
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: ADMIN_HOME_TEXT + testFooter,
    reply_markup: adminReplyKeyboard(),
  });
  if (admin) {
    await renderAdminHomeDashboard(admin, sendDeliver(chatId));
  }
}

// Разделы, открываемые кнопками Reply Keyboard. Каждый раздел — новое
// сообщение с inline-кнопками: результат всегда ниже ввода админа.
async function openHomeSection(admin: SupabaseClient, chatId: number): Promise<void> {
  await renderAdminHomeDashboard(admin, sendDeliver(chatId));
}

async function openPeopleSection(admin: SupabaseClient, telegramId: number, chatId: number): Promise<void> {
  await renderPeopleMenu(admin, telegramId, sendDeliver(chatId));
}

async function openLeadsSection(admin: SupabaseClient, chatId: number): Promise<void> {
  await renderLeadsMenu(admin, sendDeliver(chatId));
}

async function openFinanceSection(admin: SupabaseClient, chatId: number): Promise<void> {
  await renderFinanceMenu(admin, sendDeliver(chatId));
}

async function openEducationSection(chatId: number): Promise<void> {
  await renderEducationMenu(sendDeliver(chatId));
}

async function openMoreSection(chatId: number): Promise<void> {
  await renderMoreMenu(sendDeliver(chatId));
}

async function openLegacyBroadcasts(chatId: number): Promise<void> {
  await renderBroadcastMenu(sendDeliver(chatId));
}

async function openLegacyStats(admin: SupabaseClient, chatId: number): Promise<void> {
  await renderStatsOverview(admin, sendDeliver(chatId), '7d');
}

async function openLegacyModeration(admin: SupabaseClient, telegramId: number, chatId: number): Promise<void> {
  await renderModerationMenu(admin, telegramId, sendDeliver(chatId));
}

async function openLegacyWebinars(chatId: number): Promise<void> {
  await sendDeliver(chatId)('📅 Управление вебинарами', managementKeyboard());
}

async function openLegacySettings(chatId: number): Promise<void> {
  await renderMoreMenu(sendDeliver(chatId));
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
  const isLeads = isLeadsAction(data);
  const isPurchases = isPurchasesAction(data);
  const isPackages = isPackagesAction(data);
  const isEducation = isEducationAction(data);
  const isHub = isHubAction(data);
  if (!isReminder && !isTemplate && !isWebinar && !isLeads && !isPurchases && !isPackages && !isEducation && !isHub) {
    return false;
  }

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
    if (isHub) return await handleHubAction(admin, data, message, telegramId);
    if (isReminder) return await handleReminderAction(admin, data, message, telegramId);
    if (isTemplate) return await handleTemplateAction(admin, data, message, telegramId);
    if (isLeads) return await handleLeadsAction(admin, data, message, telegramId);
    if (isPurchases) return await handlePurchasesAction(admin, data, message, telegramId);
    if (isPackages) return await handlePackagesAction(admin, data, message, telegramId);
    if (isEducation) return await handleEducationAction(admin, data, message, telegramId);
    if (data === 'admin:broadcasts' || data.startsWith('admin:bc:')) {
      return await handleBroadcastAction(admin, data, message, telegramId);
    }
    if (data === 'admin:chat-control' || data.startsWith('admin:mod:')) {
      return await handleModerationAction(admin, data, message, telegramId);
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

  // Кнопки Reply Keyboard приходят точным текстом: раздел открывается новым
  // сообщением, активный сценарий сбрасывается.
  if (ADMIN_REPLY_LABEL_SET.has(text)) {
    await clearStateIfAvailable(admin, telegramId);
    if (text === ADMIN_REPLY_LABELS.home) await openHomeSection(admin, chatId);
    else if (text === ADMIN_REPLY_LABELS.people || text === ADMIN_LEGACY_REPLY_LABELS.users) {
      await openPeopleSection(admin, telegramId, chatId);
    } else if (text === ADMIN_REPLY_LABELS.education) await openEducationSection(chatId);
    else if (text === ADMIN_REPLY_LABELS.leads || text === ADMIN_LEGACY_REPLY_LABELS.leadsOld) {
      await openLeadsSection(admin, chatId);
    } else if (text === ADMIN_REPLY_LABELS.finance || text === ADMIN_LEGACY_REPLY_LABELS.purchases) {
      await openFinanceSection(admin, chatId);
    } else if (text === ADMIN_REPLY_LABELS.more || text === ADMIN_LEGACY_REPLY_LABELS.settings) {
      await openMoreSection(chatId);
    } else if (text === ADMIN_LEGACY_REPLY_LABELS.broadcasts) await openLegacyBroadcasts(chatId);
    else if (text === ADMIN_LEGACY_REPLY_LABELS.stats) await openLegacyStats(admin, chatId);
    else if (text === ADMIN_LEGACY_REPLY_LABELS.moderation) {
      await openLegacyModeration(admin, telegramId, chatId);
    } else if (text === ADMIN_LEGACY_REPLY_LABELS.webinars) await openLegacyWebinars(chatId);
    else await openMoreSection(chatId);
    return true;
  }

  if (await shouldAdminDeferTextToMaskedUi(admin, telegramId)) return false;

  let state: ConversationState | null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (isConversationStateTableError(error)) return false;
    throw error;
  }
  if (!state || state.chat_id !== chatId) {
    // Текст вне активного сценария: навигацию не ломаем,
    // подсказку показываем новым сообщением под текстом админа.
    await sendAdminMessage(chatId, ADMIN_UNKNOWN_TEXT);
    return true;
  }

  // Поиск пользователей: шаг остаётся активным, пока админ не уйдёт домой.
  if (state.step === 'users:search') {
    await renderUsersSearchResults(admin, state, text);
    return true;
  }

  // Поиск пользователя для «Нарушения пользователей»: тот же принцип.
  if (state.step === 'moderation:search') {
    await renderModerationSearchResults(admin, state, text);
    return true;
  }

  // Шаги конструктора рассылки, ожидающие текст.
  if (state.step === 'broadcast:text' || state.step === 'broadcast:button-text' || state.step === 'broadcast:button-url') {
    return handleBroadcastTextStep(admin, telegramId, state, text);
  }

  if (state.step.startsWith('notification:')) {
    return handleNotificationTextStep(admin, telegramId, state, text);
  }

  if (state.step.startsWith('edu:')) {
    return handleEducationTextStep(admin, telegramId, state, text);
  }

  if (await handleAdminComposeMessageStep(admin, telegramId, state, text)) {
    return true;
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
    // Файл — ввод админа: ответ новым сообщением.
    await renderTemplateDetail(
      admin,
      sendDeliver(state.chat_id),
      webinarId,
      reminderType,
      `📎 Файл получен.${document.fileName ? `\nИмя: ${document.fileName}` : ''}\nСтатус: ✅ Сохранён`,
    );
    return true;
  } catch (error) {
    if (isTemplateTableError(error)) {
      await renderTemplateMigrationMessage(message);
      return true;
    }
    throw error;
  }
}
