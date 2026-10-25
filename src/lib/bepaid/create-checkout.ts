export type BePaidCheckoutInput = {
  trackingId: string;
  amountByn: number;
  description: string;
  telegramId: number;
  successUrl: string;
  failUrl: string;
  notificationUrl: string;
  customField2?: string;
};

export type BePaidCheckoutResult = {
  redirectUrl: string;
  mock?: boolean;
};

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function resolveBePaidSiteUrls(requestOrigin?: string): {
  siteUrl: string;
  webhookBase: string;
} | null {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const siteUrl = fromEnv
    ? trimTrailingSlash(fromEnv)
    : process.env.NODE_ENV === 'development' && requestOrigin
      ? trimTrailingSlash(requestOrigin)
      : null;
  if (!siteUrl) return null;
  const webhookBase = process.env.BEPAY_WEBHOOK_PUBLIC_URL?.trim()
    ? trimTrailingSlash(process.env.BEPAY_WEBHOOK_PUBLIC_URL.trim())
    : siteUrl;
  return { siteUrl, webhookBase };
}

export async function createBePaidCheckout(input: BePaidCheckoutInput): Promise<BePaidCheckoutResult> {
  const shopId = process.env.BEPAY_SHOP_ID;
  const secretKey = process.env.BEPAY_SECRET_KEY;
  if (!shopId || !secretKey) {
    throw new Error('BEPAY_SHOP_ID / BEPAY_SECRET_KEY not configured');
  }

  if (process.env.NODE_ENV === 'development' && process.env.BEPAY_MOCK === 'true') {
    return { redirectUrl: input.successUrl, mock: true };
  }

  const checkoutPayload = {
    checkout: {
      test: process.env.BEPAY_TEST === 'true',
      transaction_type: 'payment',
      attempts: 3,
      settings: {
        success_url: input.successUrl,
        fail_url: input.failUrl,
        notification_url: input.notificationUrl,
        language: 'ru',
      },
      payment_method: { types: ['credit_card'] },
      order: {
        currency: 'BYN',
        amount: Math.round(input.amountByn * 100),
        description: input.description.slice(0, 255),
        tracking_id: input.trackingId,
        expired_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
      custom_fields: {
        custom_field_1: {
          label: 'Telegram ID',
          value: String(input.telegramId),
          visible: false,
        },
        ...(input.customField2
          ? {
              custom_field_2: {
                label: 'Meta',
                value: input.customField2,
                visible: false,
              },
            }
          : {}),
      },
    },
  };

  const authHeader = Buffer.from(`${shopId}:${secretKey}`).toString('base64');
  const response = await fetch('https://checkout.bepaid.by/ctp/api/checkouts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-Version': '2',
      Authorization: `Basic ${authHeader}`,
    },
    body: JSON.stringify(checkoutPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`bePaid checkout ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const redirectUrl = data?.checkout?.redirect_url as string | undefined;
  if (!redirectUrl) throw new Error('bePaid: no redirect_url');
  return { redirectUrl };
}
