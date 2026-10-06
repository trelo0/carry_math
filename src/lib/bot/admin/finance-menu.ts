import type { SupabaseClient } from '@supabase/supabase-js';
import { type Deliver, homeButton } from './core';
import { fetchFinanceHubSnapshot } from './finance-data';

function btn(label: string, count: number, callback: string): { text: string; callback_data: string } {
  return { text: count > 0 ? `${label} · ${count}` : label, callback_data: callback };
}

export async function renderFinanceMenu(admin: SupabaseClient, deliver: Deliver): Promise<void> {
  const s = await fetchFinanceHubSnapshot(admin);
  const problems = s.failedCount;
  await deliver(
    [
      '💳 Финансы',
      '',
      '⚡️ Требует внимания',
      '',
      `💰 Ожидают оплаты — ${s.dueCount}`,
      `📦 Пакеты заканчиваются — ${s.packagesEnding}`,
      problems > 0 ? `⚠️ Есть проблемы с оплатами — ${problems}` : '',
      '',
      '📊 За сегодня',
      '',
      `💰 Получено — ${s.todayReceived} BYN`,
      `🧾 Платежей — ${s.todayPaymentCount}`,
      '',
      '📦 Пакеты',
      '',
      `🟢 Активных — ${s.packagesActive}`,
      `🟡 Заканчиваются — ${s.packagesEnding}`,
      `🔴 Закончились — ${s.packagesEnded}`,
    ]
      .filter(Boolean)
      .join('\n'),
    {
      inline_keyboard: [
        [btn('💰 Требует оплаты', s.dueCount, 'af:due:0')],
        [{ text: '💳 Платежи', callback_data: 'af:pay:menu' }],
        [btn('📦 Пакеты', s.packagesEnding, 'apk:hub')],
        [{ text: '📊 Отчёты', callback_data: 'af:rep:today' }],
        [homeButton()],
      ],
    },
  );
}
