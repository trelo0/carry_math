import type { SupabaseClient } from '@supabase/supabase-js';
import { telegramSend } from '@/lib/telegram';
import { createBePaidCheckout, resolveBePaidSiteUrls } from '@/lib/bepaid/create-checkout';
import { resolveMemberChatId } from '@/lib/bot/staff/messaging';
import { getPurchaseRequest, type PurchaseRequestRow } from './purchase-requests';

export async function sendPurchaseRequestPaymentLink(
  admin: SupabaseClient,
  request: PurchaseRequestRow,
  options?: { botSuccessPath?: string },
): Promise<{ payUrl: string; mock?: boolean }> {
  const urls = resolveBePaidSiteUrls();
  if (!urls) throw new Error('NEXT_PUBLIC_SITE_URL not configured');

  const successUrl = options?.botSuccessPath
    ? `${urls.siteUrl}${options.botSuccessPath}`
    : `${urls.siteUrl}/cabinet?section=payments&payment=success`;

  const { redirectUrl, mock } = await createBePaidCheckout({
    trackingId: request.id,
    amountByn: Number(request.amount_byn),
    description: request.title,
    telegramId: request.telegram_id,
    successUrl,
    failUrl: `${urls.siteUrl}/cabinet?section=payments&payment=failed`,
    notificationUrl: `${urls.webhookBase}/api/payments/webhook`,
    customField2: request.order_kind ?? 'package',
  });

  const chatId = await resolveMemberChatId(admin, request.telegram_id);
  if (chatId) {
    await telegramSend('sendMessage', {
      chat_id: chatId,
      text: [
        '💳 Ссылка на оплату',
        '',
        request.title,
        `Сумма: ${request.amount_byn} BYN`,
        '',
        'После успешной оплаты статус обновится автоматически.',
      ].join('\n'),
      reply_markup: {
        inline_keyboard: [[{ text: `💳 Оплатить ${request.amount_byn} BYN`, url: redirectUrl }]],
      },
    });
  }

  return { payUrl: redirectUrl, mock };
}

export async function sendPaymentLinkByRequestId(
  admin: SupabaseClient,
  requestId: string,
): Promise<{ payUrl: string }> {
  const request = await getPurchaseRequest(admin, requestId);
  if (!request) throw new Error('Заказ не найден');
  if (request.status !== 'pending') throw new Error('Ссылка доступна только для заказа в статусе «ожидает оплаты»');
  return sendPurchaseRequestPaymentLink(admin, request);
}
