import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAccessProduct } from '@/lib/bot/accesses';
import {
  fulfillPurchase,
  PurchaseFulfillError,
  resolveTelegramIdByPhone,
} from '@/lib/bot/purchase-fulfillment';

export const dynamic = 'force-dynamic';

type Body = {
  product?: string;
  packageIndex?: number;
  teacherId?: string;
  externalId?: string;
  /** Только при вызове с PURCHASE_FULFILL_SECRET — для ручной выдачи ops. */
  telegramId?: number;
};

/** Ручное подтверждение покупки до эквайринга. Позже тот же путь вызовет webhook. */
export async function POST(request: Request) {
  const secret = process.env.PURCHASE_FULFILL_SECRET;
  const headerSecret = request.headers.get('x-fulfill-secret');
  const isSecretCall = Boolean(secret && headerSecret === secret);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.product || !isAccessProduct(body.product)) {
    return NextResponse.json({ error: 'Invalid product' }, { status: 400 });
  }

  let telegramId: number | null = null;

  if (isSecretCall) {
    if (typeof body.telegramId !== 'number') {
      return NextResponse.json({ error: 'telegramId required for secret call' }, { status: 400 });
    }
    telegramId = body.telegramId;
  } else {
    if (!secret) {
      return NextResponse.json(
        { error: 'Fulfillment by session disabled until acquiring is connected' },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const admin = createAdminClient();
    const result = await fulfillPurchase(admin, telegramId, {
      product: body.product,
      packageIndex: body.packageIndex,
      teacherId: body.teacherId,
      externalId: body.externalId,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PurchaseFulfillError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    console.error('[purchase/fulfill]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** GET — проверка привязки telegram для ops (optional). */
export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const phone = (data.user.user_metadata?.phone as string) ?? data.user.phone ?? '';
  try {
    const admin = createAdminClient();
    const telegramId = await resolveTelegramIdByPhone(admin, phone);
    return NextResponse.json({ phone, telegramLinked: telegramId != null, telegramId });
  } catch {
    return NextResponse.json({ phone, telegramLinked: false });
  }
}
