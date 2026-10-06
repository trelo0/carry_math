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
    [{ text: '🔎 Найти человека', callback_data: 'ah:people:search' }],
    [{ text: '👨‍🎓 Ученики', callback_data: 'ah:stu:menu' }],
    [{ text: '👨‍💼 Сотрудники', callback_data: 'ah:staff:f:all:0' }],
    [homeButton()],
  ];
  await deliver(
    '👥 Люди\n\nПоиск, списки учеников и сотрудников. Карточка человека — связующий центр.',
    { inline_keyboard: keyboard },
  );
}
