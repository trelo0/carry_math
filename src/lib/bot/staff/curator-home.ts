import type { InlineKeyboard } from '@/lib/bot/admin/core';
import { CURATOR_BOT_WELCOME_TEXT } from './curator-bot-screens';

/** Главный экран куратора (только текст; разделы — reply-меню). */
export function buildCuratorBotWelcome(): { text: string; keyboard: InlineKeyboard } {
  return {
    text: CURATOR_BOT_WELCOME_TEXT,
    keyboard: { inline_keyboard: [] },
  };
}

/** @deprecated Старый home со статистикой — не используется в новом боте. */
export async function buildCuratorHomeScreen(
  _admin: unknown,
  _curatorTelegramId: number,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  return buildCuratorBotWelcome();
}
