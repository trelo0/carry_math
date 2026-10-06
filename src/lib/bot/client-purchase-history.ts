import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isPurchaseRequestTableError,
  listPurchaseRequestsForTelegram,
  type PurchaseRequestRow,
  type PurchaseRequestStatus,
} from './purchase-requests';
import {
  clientHomeButton,
  deliverClientHubScreen,
  type ClientHubDeliverOptions,
} from './client-nav';

function statusLabel(status: PurchaseRequestStatus): string {
  switch (status) {
    case 'pending':
      return 'ожидает подтверждения';
    case 'approved':
      return 'подтверждена';
    case 'rejected':
      return 'отклонена';
    default:
      return status;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Minsk',
  });
}

export async function showClientPurchaseHistory(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  let rows: PurchaseRequestRow[] = [];
  try {
    rows = await listPurchaseRequestsForTelegram(admin, telegramId);
  } catch (error) {
    if (!isPurchaseRequestTableError(error)) throw error;
  }

  const keyboard = { inline_keyboard: [[clientHomeButton()]] };

  if (rows.length === 0) {
    const text =
      '🧾 История\n\n' +
      'Заявок на оплату пока нет. Когда оформите покупку на сайте или через бота, она появится здесь.';
    await deliverClientHubScreen(admin, telegramId, chatId, 'purchase-history-empty', text, keyboard, deliver);
    return;
  }

  const lines = ['🧾 История', ''];
  for (const row of rows) {
    lines.push(
      `• ${row.title}`,
      `${row.amount_byn} BYN · ${statusLabel(row.status)}`,
      formatDate(row.created_at),
      '',
    );
  }

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'purchase-history',
    lines.join('\n').trim(),
    keyboard,
    deliver,
  );
}
