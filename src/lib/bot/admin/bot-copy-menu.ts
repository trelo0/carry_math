import type { Deliver } from './core';
import { homeButton } from './core';
import { listBotCopyForAdmin, sanityStudioBotSettingsHint } from '@/lib/bot/bot-copy';

export async function renderBotCopyMenu(deliver: Deliver): Promise<void> {
  const items = await listBotCopyForAdmin();
  const studio = sanityStudioBotSettingsHint();
  const lines = [
    '💬 Тексты бота для гостей',
    '',
    'Редактирование — в Sanity Studio (документ «Тексты Telegram-бота»).',
    'Ключ в Studio должен совпадать с ключом в списке ниже.',
    '',
    studio,
    '',
    '---',
  ];
  for (const item of items) {
    lines.push('', `▸ ${item.title}`, `Ключ: \`${item.key}\``, item.preview.replace(/\n/g, ' '));
  }
  await deliver(lines.join('\n'), {
    inline_keyboard: [[{ text: '⬅️ Прочее', callback_data: 'ah:more' }], [homeButton()]],
  });
}
