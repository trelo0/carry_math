import type { SupabaseClient } from '@supabase/supabase-js';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import type { Deliver, InlineButton } from './core';
import { homeButton } from './core';

export async function renderAdminWebPanel(
  admin: SupabaseClient,
  telegramId: number,
  deliver: Deliver,
): Promise<void> {
  const url = await createCabinetLoginUrl(admin, telegramId, '/cabinet/staff');
  const keyboard: InlineButton[][] = [
    [{ text: '🌐 Открыть панель управления', url }],
    [homeButton()],
  ];
  await deliver(
    [
      '🖥 Панель управления',
      '',
      'Расширенное управление школой доступно в веб-панели администратора.',
      '',
      'Ссылка одноразовая, действует около 15 минут.',
    ].join('\n'),
    { inline_keyboard: keyboard },
  );
}
