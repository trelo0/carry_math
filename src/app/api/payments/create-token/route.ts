import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createPurchaseRequest } from '@/lib/bot/purchase-requests';
import { resolvePurchaseOffer } from '@/lib/bot/purchase-fulfillment';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';
import { getCabinetPricing } from '@/lib/studio/cabinetSettings';

export const dynamic = 'force-dynamic';

type Body = {
  courseSlug?: string;
  scenario?: 'start_from_beginning' | 'join_current';
};

/**
 * Создаёт payment token bePaid для оплаты курса.
 * Требует авторизованной сессии кабинета (telegram_id).
 */
export async function POST(request: Request) {
  // Проверка переменных окружения
  const shopId = process.env.BEPAY_SHOP_ID;
  const secretKey = process.env.BEPAY_SECRET_KEY;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (!shopId || !secretKey) {
    return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 500 });
  }

  if (!siteUrl) {
    return NextResponse.json({ error: 'Site URL not configured' }, { status: 500 });
  }

  // Авторизация пользователя
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Получение telegram_id из user_metadata
  const telegramId = user.user_metadata?.telegram_id as number | undefined;
  if (!telegramId || typeof telegramId !== 'number') {
    return NextResponse.json({ error: 'Telegram account not linked' }, { status: 400 });
  }

  // Парсинг тела запроса
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { courseSlug, scenario } = body;

  if (!courseSlug) {
    return NextResponse.json({ error: 'courseSlug required' }, { status: 400 });
  }

  if (scenario && !['start_from_beginning', 'join_current'].includes(scenario)) {
    return NextResponse.json({ error: 'Invalid scenario' }, { status: 400 });
  }

  // Загрузка информации о курсе
  const courseContent = await getDistrictCourseContent(courseSlug).catch(() => null);
  if (!courseContent) {
    return NextResponse.json({ error: 'Course not found' }, { status: 404 });
  }

  const amountByn = courseContent.priceByn;
  if (!amountByn || amountByn <= 0) {
    return NextResponse.json({ error: 'Invalid course price' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Одна активная заявка (pending/processing) на курс + сценарий
  const { data: existingRequest } = await admin
    .from('purchase_requests')
    .select('id, status, created_at')
    .eq('telegram_id', telegramId)
    .eq('product', 'course')
    .eq('course_slug', courseSlug)
    .eq('scenario', scenario ?? null)
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingRequest) {
    return NextResponse.json(
      { error: 'У вас уже есть активная заявка на этот курс. Подождите или свяжитесь с поддержкой.' },
      { status: 409 },
    );
  }

  const pricing = await getCabinetPricing();
  const offer = await resolvePurchaseOffer(pricing, {
    product: 'course',
    packageIndex: 0,
    courseSlug,
  });

  if (offer.amountByn !== amountByn) {
    console.error('[bePaid create token] Price mismatch Sanity vs offer', { amountByn, offerAmount: offer.amountByn });
    return NextResponse.json({ error: 'Invalid course price' }, { status: 400 });
  }

  // Создание записи в purchase_requests
  const purchaseRequest = await createPurchaseRequest(admin, {
    telegramId,
    product: 'course',
    packageIndex: 0,
    title: courseContent.title,
    amountByn,
    courseSlug,
    scenario: scenario ?? null,
    lessonsCount: offer.lessons,
  });

  // Создание payment token bePaid
  const checkoutUrl = 'https://checkout.bepaid.by/ctp/api/checkouts';
  const trackingId = purchaseRequest.id; // UUID purchase_requests

  const checkoutPayload = {
    checkout: {
      test: process.env.BEPAY_TEST === 'true',
      transaction_type: 'payment',
      attempts: 3,
      settings: {
        success_url: `${siteUrl}/cabinet?section=payments&payment=success`,
        fail_url: `${siteUrl}/cabinet?section=payments&payment=failed`,
        notification_url: `${siteUrl}/api/payments/webhook`,
        language: 'ru',
      },
      payment_method: {
        types: ['credit_card'],
      },
      order: {
        currency: 'BYN',
        amount: Math.round(amountByn * 100), // Минимальные единицы
        description: `Курс: ${courseContent.title}`,
        tracking_id: trackingId,
        expired_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 часа
      },
      custom_fields: {
        custom_field_1: {
          label: 'Telegram ID',
          value: String(telegramId),
          visible: false,
        },
        custom_field_2: {
          label: 'Scenario',
          value: scenario || 'default',
          visible: false,
        },
      },
    },
  };

  // HTTP Basic Auth: shop_id:secret_key в base64
  const authHeader = Buffer.from(`${shopId}:${secretKey}`).toString('base64');

  try {
    const response = await fetch(checkoutUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-API-Version': '2',
        'Authorization': `Basic ${authHeader}`,
      },
      body: JSON.stringify(checkoutPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[bePaid create token]', response.status, errorText);
      // Помечаем заявку как failed, т.к. bePaid не смог создать платёж
      try {
        await admin
          .from('purchase_requests')
          .update({ status: 'rejected', resolved_at: new Date().toISOString() })
          .eq('id', purchaseRequest.id);
      } catch (updateError) {
        console.error('[bePaid create token] Failed to mark request as rejected:', updateError);
      }
      return NextResponse.json(
        { error: 'Failed to create payment token' },
        { status: response.status },
      );
    }

    const data = await response.json();
    const redirectUrl = data?.checkout?.redirect_url;

    if (!redirectUrl) {
      console.error('[bePaid create token] No redirect_url in response', data);
      // Помечаем заявку как failed
      try {
        await admin
          .from('purchase_requests')
          .update({ status: 'rejected', resolved_at: new Date().toISOString() })
          .eq('id', purchaseRequest.id);
      } catch (updateError) {
        console.error('[bePaid create token] Failed to mark request as rejected:', updateError);
      }
      return NextResponse.json(
        { error: 'Invalid payment gateway response' },
        { status: 500 },
      );
    }

    return NextResponse.json({ redirect_url: redirectUrl });
  } catch (error) {
    console.error('[bePaid create token]', error);
    // При сетевой ошибке не помечаем как failed - возможно, bePaid создал платёж
    // Это требует ручной проверки или retry логики
    return NextResponse.json({ error: 'Payment gateway error' }, { status: 500 });
  }
}
