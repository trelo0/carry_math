import type { SupabaseClient } from '@supabase/supabase-js';
import { type Deliver, type InlineButton, homeButton } from './core';

export async function renderPeopleMenu(
  admin: SupabaseClient,
  telegramId: number,
  deliver: Deliver,
): Promise<void> {
  void admin;
  void telegramId;
  const keyboard: InlineButton[][] = [
    [{ text: '🔎 Найти человека', callback_data: 'admin:users:search' }],
    [{ text: '👨‍🎓 Ученики', callback_data: 'ah:stu:menu' }],
    [{ text: '👨‍💼 Сотрудники', callback_data: 'ah:staff:0' }],
    [{ text: '👥 Все пользователи', callback_data: 'admin:users' }],
    [homeButton()],
  ];
  await deliver(
    '👥 Люди\n\nПоиск, каталоги учеников и сотрудников. Карточка человека — центр управления.',
    { inline_keyboard: keyboard },
  );
}
