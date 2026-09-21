import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import {
  canManageBotRoles,
  ensureMember,
  isAdminEnv,
  isBotRole,
  isCreatorTelegramId,
  listMembers,
  ROLE_LABELS,
  setRole,
  setViewRole,
  type BotRole,
} from '@/lib/bot/roles';

const ASSIGNABLE_ROLE_NAMES = Object.keys(ROLE_LABELS).filter((role) => role !== 'mentor');

type TgMessage = {
  text?: string;
  chat?: { id: number };
  from?: { id: number };
  reply_to_message?: { from?: { id: number } };
};

/** /as, /role, /users, /id — до сценариев ролей, чтобы создатель не терял доступ. */
export async function handlePrivilegedBotCommands(
  admin: SupabaseClient,
  message: TgMessage,
): Promise<boolean> {
  if (!message.text || !message.chat || !message.from) return false;

  const chatId = message.chat.id;
  const fromId = message.from.id;
  const text = message.text;

  if (text === '/id') {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: `Твой Telegram ID: ${fromId}`,
    });
    return true;
  }

  if (text === '/users') {
    const caller = await ensureMember(admin, fromId, {});
    if (!canManageBotRoles(fromId, caller.role)) {
      await telegramSend('sendMessage', { chat_id: chatId, text: 'Недостаточно прав.' });
      return true;
    }
    const members = await listMembers(admin);
    const lines = members.map(
      (m) =>
        `${m.telegram_id} · ${ROLE_LABELS[m.role as BotRole] ?? m.role} · ${m.phone ?? m.full_name ?? ''}`,
    );
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: lines.length > 0 ? lines.join('\n') : 'Пока никого нет.',
    });
    return true;
  }

  if (text.startsWith('/as')) {
    const member = await ensureMember(admin, fromId, {});
    if (!canManageBotRoles(fromId, member.role)) {
      await telegramSend('sendMessage', { chat_id: chatId, text: 'Недостаточно прав.' });
      return true;
    }

    const arg = text.slice('/as'.length).trim();
    if (arg === 'reset' || arg === '') {
      await setViewRole(admin, fromId, null);
      await telegramSend('sendMessage', { chat_id: chatId, text: '🧪 Маска сброшена.' });
      return true;
    }

    const maskRole = arg === 'mentor' ? 'curator' : arg;
    if (!isBotRole(maskRole)) {
      await telegramSend('sendMessage', {
        chat_id: chatId,
        text: `Формат: /as <роль> или /as reset. Роли: ${ASSIGNABLE_ROLE_NAMES.join(', ')}.`,
      });
      return true;
    }

    await setViewRole(admin, fromId, maskRole);
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: `🧪 Включена маска «${ROLE_LABELS[maskRole]}». Напиши /start — увидишь бот глазами этой роли.`,
    });
    return true;
  }

  if (!text.startsWith('/role')) return false;

  const caller = await ensureMember(admin, fromId, {});
  if (!canManageBotRoles(fromId, caller.role)) {
    await telegramSend('sendMessage', { chat_id: chatId, text: 'Недостаточно прав.' });
    return true;
  }

  const args = text.slice('/role'.length).trim().split(/\s+/).filter(Boolean);

  if (args.length === 1 && args[0] === 'reset' && isCreatorTelegramId(fromId)) {
    await setRole(admin, fromId, 'admin');
    await setViewRole(admin, fromId, null);
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: '✅ Роль admin восстановлена, маска сброшена.',
    });
    return true;
  }

  let targetId: number | null = null;
  let roleArg = '';
  if (args.length >= 2 && (args[0] === 'me' || args[0] === 'self')) {
    targetId = fromId;
    roleArg = args[1];
  } else if (args.length >= 2 && /^\d+$/.test(args[0])) {
    targetId = Number(args[0]);
    roleArg = args[1];
  } else if (args.length === 1) {
    targetId = message.reply_to_message?.from?.id ?? null;
    roleArg = args[0];
  }

  if (roleArg === 'mentor') roleArg = 'curator';

  if (!targetId || !isBotRole(roleArg)) {
    const resetHint = isCreatorTelegramId(fromId) ? '\n/role reset — вернуть admin (создатель).' : '';
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: `Формат: /role me <роль> или /role <id> <роль>. Роли: ${ASSIGNABLE_ROLE_NAMES.join(', ')}.${resetHint}`,
    });
    return true;
  }

  if (roleArg === 'test' && !isAdminEnv(fromId)) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: 'Роль test назначается только владельцу.',
    });
    return true;
  }

  const found = await setRole(admin, targetId, roleArg);
  await telegramSend('sendMessage', {
    chat_id: chatId,
    text: found
      ? `✅ Роль «${ROLE_LABELS[roleArg as BotRole]}» установлена для ${targetId}.`
      : 'Такого участника нет — пусть сначала напишет боту.',
  });
  return true;
}
