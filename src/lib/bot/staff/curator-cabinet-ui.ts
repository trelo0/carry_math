import type { InlineKeyboard } from '@/lib/bot/admin/core';

export function withCuratorCabinetRow(
  keyboard: InlineKeyboard['inline_keyboard'],
  cabinetUrl: string | null,
  options?: { includeCabinet?: boolean },
): InlineKeyboard['inline_keyboard'] {
  const rows = [...keyboard];
  if (options?.includeCabinet === false) return rows;
  if (cabinetUrl) {
    rows.push([{ text: '🌐 Панель управления', url: cabinetUrl }]);
  } else {
    rows.push([{ text: '🌐 Панель управления', callback_data: 'c:cab' }]);
  }
  return rows;
}
