import type { SupabaseClient } from '@supabase/supabase-js';
import { type Deliver, homeButton } from './core';
import { fetchAdminHubMetrics } from './hub-metrics';

export async function renderFinanceMenu(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const metrics = await fetchAdminHubMetrics(admin);
  await deliver(
    [
      '💳 Финансы',
      '',
      `⏳ Ожидают подтверждения: ${metrics.purchasesPending}`,
      `📦 Активных пакетов ≤2 занятия: ${metrics.packagesLow}`,
      '',
      'Пакеты: остатки, перебор с расписанием, ручная коррекция.',
    ].join('\n'),
    {
      inline_keyboard: [
        [{ text: '⏳ Заявки на оплату', callback_data: 'ah:go:finance:pending' }],
        [{ text: '📦 Пакеты и остатки', callback_data: 'ah:go:finance:packages' }],
        [{ text: '⚠️ Перебор (занятий > остатка)', callback_data: 'ah:go:finance:overbook' }],
        [homeButton()],
      ],
    },
  );
}
