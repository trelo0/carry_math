import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isPurchaseRequestTableError,
  listPurchaseRequestsForTelegram,
  type PurchaseRequestRow,
  type PurchaseRequestStatus,
} from './purchase-requests';
import { clientHomeButton, loadClientHub, saveClientHub, sendHubMessage, editHubMessage } from './client-nav';

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
    const hub = await loadClientHub(admin, telegramId);
    if (hub) {
      const ok = await editHubMessage(hub, text, keyboard);
      if (ok) {
        await saveClientHub(admin, telegramId, hub, 'purchase-history-empty');
        return;
      }
    }
    const messageId = await sendHubMessage(chatId, text, keyboard);
    if (messageId) await saveClientHub(admin, telegramId, { chatId, messageId }, 'purchase-history-empty');
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

  const text = lines.join('\n').trim();
  const hub = await loadClientHub(admin, telegramId);
  if (hub) {
    const ok = await editHubMessage(hub, text, keyboard);
    if (ok) {
      await saveClientHub(admin, telegramId, hub, 'purchase-history');
      return;
    }
  }
  const messageId = await sendHubMessage(chatId, text, keyboard);
  if (messageId) await saveClientHub(admin, telegramId, { chatId, messageId }, 'purchase-history');
}
