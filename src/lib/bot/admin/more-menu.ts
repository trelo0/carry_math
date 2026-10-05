import type { Deliver, InlineButton } from './core';
import { homeButton } from './core';

export async function renderMoreMenu(deliver: Deliver): Promise<void> {
  const keyboard: InlineButton[][] = [
    [{ text: '📢 Рассылки', callback_data: 'admin:broadcasts' }],
    [{ text: '🚨 Контроль переписки', callback_data: 'admin:chat-control' }],
    [
      { text: '🚩 Проблемы', callback_data: 'ah:problems' },
      { text: '📜 Журнал', callback_data: 'ah:audit:0' },
    ],
    [{ text: '📊 Статистика', callback_data: 'admin:stats' }],
    [{ text: '📈 Операционный отчёт', callback_data: 'ah:report:ops' }],
    [
      { text: '📝 ДЗ на проверке', callback_data: 'ah:hw:pending' },
      { text: '💬 Непрочитанные', callback_data: 'ah:msg:unread' },
    ],
    [{ text: '📅 Вебинары', callback_data: 'admin:webinars' }],
    [
      { text: '🔔 Шаблоны уведомлений', callback_data: 'an:menu' },
      { text: '🧪 Тест уведомлений', callback_data: 'ar:menu' },
    ],
    [{ text: '🔐 Личный кабинет', callback_data: 'ah:cabinet' }],
    [homeButton()],
  ];
  await deliver('⚙️ Прочее\n\nСервисные разделы бота.', { inline_keyboard: keyboard });
}
