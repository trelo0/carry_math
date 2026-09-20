import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  clearStateIfAvailable,
  getState,
  isConversationStateTableError,
  saveState,
  sendAdminMessage,
} from './admin/core';

export async function beginStudentSupport(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
): Promise<void> {
  try {
    await saveState(admin, telegramId, { chatId, messageId: 0 }, 'student:support', {});
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
  }

  await sendAdminMessage(
    chatId,
    '🆘 Поддержка\n\nОпишите вопрос одним сообщением — текст, фото или документ.\n\n⬅️ Отмена — напишите «Отмена».',
  );
}

async function getAdminChatIds(admin: SupabaseClient): Promise<number[]> {
  const envIds = (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const roleFilter = envIds.length
    ? `role.eq.admin,telegram_id.in.(${envIds.join(',')})`
    : 'role.eq.admin';

  const { data, error } = await admin
    .from('bot_members')
    .select('chat_id, telegram_id')
    .or(roleFilter)
    .not('chat_id', 'is', null);
  if (error) throw error;

  const ids = new Set<number>();
  for (const row of data ?? []) {
    const chatId = (row as { chat_id: number | null }).chat_id;
    if (typeof chatId === 'number') ids.add(chatId);
  }
  return [...ids];
}

async function memberLabel(admin: SupabaseClient, telegramId: number): Promise<string> {
  const [{ data: member }, { data: link }] = await Promise.all([
    admin.from('bot_members').select('full_name, phone').eq('telegram_id', telegramId).maybeSingle(),
    admin.from('telegram_links').select('phone').eq('telegram_id', telegramId).maybeSingle(),
  ]);
  const phone = link?.phone ?? member?.phone;
  const name = member?.full_name;
  if (name && phone) return `${name} · ${phone}`;
  if (name) return name;
  if (phone) return phone;
  return `ID ${telegramId}`;
}

export async function notifyAdminsOfSupportMessage(
  admin: SupabaseClient,
  studentTelegramId: number,
  text: string,
): Promise<void> {
  const adminChatIds = await getAdminChatIds(admin);
  if (adminChatIds.length === 0) return;

  const label = await memberLabel(admin, studentTelegramId);
  const body = ['🆘 Сообщение в поддержку', '', `👤 ${label}`, '', text].join('\n');

  await Promise.all(
    adminChatIds.map((chatId) =>
      telegramSend('sendMessage', { chat_id: chatId, text: body }).catch(() => undefined),
    ),
  );
}

export async function handleStudentSupportMessage(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  text: string,
): Promise<boolean> {
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }
  if (!state || state.step !== 'student:support') return false;

  const trimmed = text.trim();
  if (!trimmed || /^отмена$/i.test(trimmed)) {
    await clearStateIfAvailable(admin, telegramId);
    await sendAdminMessage(chatId, 'Обращение отменено.');
    return true;
  }

  await notifyAdminsOfSupportMessage(admin, telegramId, trimmed);
  await clearStateIfAvailable(admin, telegramId);
  await sendAdminMessage(
    chatId,
    '✅ Сообщение отправлено в поддержку.\n\nМы ответим в Telegram или по телефону из профиля.',
  );
  return true;
}

export async function handleStudentSupportAttachment(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  caption: string,
): Promise<boolean> {
  let state = null;
  try {
    state = await getState(admin, telegramId);
  } catch (error) {
    if (!isConversationStateTableError(error)) throw error;
    return false;
  }
  if (!state || state.step !== 'student:support') return false;

  const label = await memberLabel(admin, telegramId);
  const adminChatIds = await getAdminChatIds(admin);
  const body = ['🆘 Вложение в поддержку', '', `👤 ${label}`, caption ? `\n${caption}` : ''].join('\n');

  await Promise.all(
    adminChatIds.map((id) => telegramSend('sendMessage', { chat_id: id, text: body }).catch(() => undefined)),
  );
  await clearStateIfAvailable(admin, telegramId);
  await sendAdminMessage(chatId, '✅ Вложение отправлено в поддержку.');
  return true;
}
