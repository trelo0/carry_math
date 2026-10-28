import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { staffStudentLabel } from '@/lib/bot/staff/messaging';
import { resolveMemberChatId } from '@/lib/bot/staff/messaging';
import { openStaffStudentDmTopic, staffDmTopicsEnabled } from '@/lib/bot/staff/dm-topics';
import { resolvePrimaryAdminTelegramId } from './admin-guest-inbox';

/** Callback: открыть/создать admin↔клиент topic (обрабатывается в comms-ops). */
export function adminClientTopicCallback(clientTelegramId: number): string {
  return `ah:msg:w:${clientTelegramId}`;
}

export async function openAdminClientDmTopic(
  admin: SupabaseClient,
  adminTelegramId: number,
  clientTelegramId: number,
  introText?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!staffDmTopicsEnabled()) {
    return { ok: false, error: 'Topics отключены (STAFF_DM_TOPICS_ENABLED).' };
  }
  return openStaffStudentDmTopic(admin, {
    staffTelegramId: adminTelegramId,
    studentTelegramId: clientTelegramId,
    staffRole: 'admin',
    introText,
  });
}

/** Короткое уведомление в General + кнопка «Связаться» (без дубля staff_messages). */
export async function notifyAdminClientContactPing(
  admin: SupabaseClient,
  adminChatId: number,
  clientTelegramId: number,
  params: { header: string; preview?: string; courseTitle?: string },
): Promise<boolean> {
  const label = await staffStudentLabel(admin, clientTelegramId);
  const lines = [params.header, '', `👤 ${label}`];
  if (params.courseTitle?.trim()) {
    lines.splice(2, 0, `📚 ${params.courseTitle.trim()}`);
  }
  const preview = params.preview?.trim();
  if (preview) lines.push('', preview.length > 400 ? `${preview.slice(0, 397)}…` : preview);
  lines.push('', 'Переписка — в Topics (тема с этим человеком).');

  const sent = await telegramSend('sendMessage', {
    chat_id: adminChatId,
    text: lines.join('\n'),
    reply_markup: {
      inline_keyboard: [[{ text: '💬 Связаться', callback_data: adminClientTopicCallback(clientTelegramId) }]],
    },
  });
  return sent.ok;
}

/** Кабинет на сайте: «Написать в поддержку» → пинг админу; тема — по «Связаться». */
export async function notifyAdminCabinetSupportIntent(
  admin: SupabaseClient,
  clientTelegramId: number,
  options?: { courseTitle?: string },
): Promise<void> {
  const adminId = await resolvePrimaryAdminTelegramId(admin);
  if (!adminId) return;
  const adminChatId = (await resolveMemberChatId(admin, adminId)) ?? adminId;

  if (staffDmTopicsEnabled()) {
    await notifyAdminClientContactPing(admin, adminChatId, clientTelegramId, {
      header: '📱 Поддержка из личного кабинета',
      preview:
        'Ученик нажал «Написать в поддержку» на сайте и открыл диалог в Telegram. Сообщение появится в теме после отправки; тему можно открыть уже сейчас.',
      courseTitle: options?.courseTitle,
    });
    return;
  }

  const label = await staffStudentLabel(admin, clientTelegramId);
  await telegramSend('sendMessage', {
    chat_id: adminChatId,
    text: ['📱 Поддержка из личного кабинета', '', `👤 ${label}`, '', 'Ученик перешёл в бот поддержки с сайта.'].join(
      '\n',
    ),
    reply_markup: {
      inline_keyboard: [[{ text: '👤 Профиль', callback_data: `admin:user:${clientTelegramId}::` }]],
    },
  });
}
