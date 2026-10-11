import type { Deliver, InlineButton } from './core';
import { homeButton } from './core';

export async function renderMoreMenu(deliver: Deliver): Promise<void> {
  const keyboard: InlineButton[][] = [
    [{ text: '❤️ Восстановить жизни всем (месяц)', callback_data: 'al:rm' }],
    [{ text: '📢 Рассылки', callback_data: 'admin:broadcasts' }],
    [{ text: '🚨 Проблемы и контроль', callback_data: 'ah:more:problems-control' }],
    [{ text: '📝 Журнал событий', callback_data: 'ah:audit:all:0:all' }],
    [{ text: '📊 Отчёты', callback_data: 'ah:more:reports' }],
    [homeButton()],
  ];
  await deliver(
    [
      '⚙️ Прочее',
      '',
      '❤️ Жизни — восстановить всем до 3 за текущий месяц (МСК)',
      '📢 Рассылки — сообщения ученикам и клиентам',
      '🚨 Проблемы и контроль — внимание и переписка',
      '📝 Журнал событий — что произошло в системе',
      '📊 Отчёты — сводка работы школы',
    ].join('\n'),
    { inline_keyboard: keyboard },
  );
}
