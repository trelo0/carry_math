import { NextResponse } from 'next/server';
import { getCabinetAuth } from '@/lib/cabinet-auth';
import {
  ensurePendingCoursePurchaseRequest,
  isPostgresUniqueViolation,
} from '@/lib/bot/purchase-requests';
import {
  PurchaseFulfillError,
  resolvePurchaseOffer,
} from '@/lib/bot/purchase-fulfillment';
import {
  hasPurchaseScenarioCards,
  solePurchaseScenario,
} from '@/lib/course-purchase-scenario';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';
import { getCabinetPricing } from '@/lib/studio/cabinetSettings';
import { recordCheckoutStarted } from '@/lib/bot/admin/user-activity-events';

export const dynamic = 'force-dynamic';

type Body = {
  courseSlug?: string;
  scenario?: 'start_from_beginning' | 'join_current';
};

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** URL для return/webhook: env или origin запроса в dev. */
function resolveSiteUrl(request: Request): string | null {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return trimTrailingSlash(fromEnv);
  if (process.env.NODE_ENV === 'development') {
    return trimTrailingSlash(new URL(request.url).origin);
  }
  return null;
}

function paymentErrorMessage(error: unknown): string {
  if (error instanceof PurchaseFulfillError) {
    return error.message;
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('purchase_requests')) {
    return 'Не настроена таблица заявок на оплату (purchase_requests).';
  }
  if (isPostgresUniqueViolation(error)) {
    return 'У вас уже есть незавершённая заявка на оплату курса. Откройте «Платежи» в кабинете или напишите в поддержку.';
  }
  return 'Не удалось создать платёж. Попробуйте позже или напишите в поддержку.';
}

/**
 * Создаёт payment token bePaid для оплаты курса.
 * Требует авторизованной сессии кабинета (telegram_links).
 */
export async function POST(request: Request) {
  try {
    const shopId = process.env.BEPAY_SHOP_ID;
    const secretKey = process.env.BEPAY_SECRET_KEY;
    const siteUrl = resolveSiteUrl(request);

    if (!shopId || !secretKey) {
      return NextResponse.json(
        { error: 'Платёжный шлюз не настроен (BEPAY_SHOP_ID / BEPAY_SECRET_KEY).' },
        { status: 500 },
      );
    }

    if (!siteUrl) {
      return NextResponse.json(
        { error: 'Не задан NEXT_PUBLIC_SITE_URL (нужен для возврата после оплаты).' },
        { status: 500 },
      );
    }

    const auth = await getCabinetAuth();
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { telegramId, admin } = auth;

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

    const courseContent = await getDistrictCourseContent(courseSlug).catch(() => null);
    if (!courseContent) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    const { resolveCourseIdForContent } = await import('@/lib/bot/education/course-record');
    const courseId = await resolveCourseIdForContent(admin, courseContent);

    const purchaseScenarios = courseContent.purchaseScenarios;
    const scenarioCards = hasPurchaseScenarioCards(purchaseScenarios);

    let enrollmentHasScenario = false;
    if (courseId) {
      const { data: enrollment } = await admin
        .from('course_enrollments')
        .select('purchase_scenario')
        .eq('telegram_id', telegramId)
        .eq('course_id', courseId)
        .maybeSingle();
      const saved = enrollment?.purchase_scenario;
      enrollmentHasScenario = saved === 'start_from_beginning' || saved === 'join_current';
    }

    let effectiveScenario: 'start_from_beginning' | 'join_current' | null = scenario ?? null;

    if (enrollmentHasScenario) {
      effectiveScenario = null;
    } else if (scenarioCards) {
      if (!effectiveScenario) {
        effectiveScenario = solePurchaseScenario(purchaseScenarios);
      }
      if (!effectiveScenario) {
        return NextResponse.json(
          { error: 'Выберите формат обучения (scenario required).' },
          { status: 400 },
        );
      }
      if (
        effectiveScenario === 'start_from_beginning' &&
        !purchaseScenarios?.startFromBeginning
      ) {
        return NextResponse.json({ error: 'Invalid scenario for course' }, { status: 400 });
      }
      if (effectiveScenario === 'join_current' && !purchaseScenarios?.joinCurrent) {
        return NextResponse.json({ error: 'Invalid scenario for course' }, { status: 400 });
      }
    } else {
      effectiveScenario = 'start_from_beginning';
    }

    const pricing = await getCabinetPricing();
    const offer = await resolvePurchaseOffer(pricing, {
      product: 'course',
      packageIndex: 0,
      courseSlug,
    });

    const amountByn = offer.amountByn;
    if (!amountByn || amountByn <= 0) {
      return NextResponse.json(
        { error: 'У курса не задана цена в Sanity (pricing → priceByn).' },
        { status: 400 },
      );
    }

    const processingQuery = admin
      .from('purchase_requests')
      .select('id')
      .eq('telegram_id', telegramId)
      .eq('product', 'course')
      .eq('package_index', 0)
      .is('teacher_id', null)
      .eq('status', 'processing')
      .eq('course_slug', courseSlug);
    const { data: processingRequest } = await processingQuery.maybeSingle();

    if (processingRequest) {
      return NextResponse.json(
        {
          error:
            'Платёж по предыдущей заявке ещё обрабатывается. Подождите минуту или откройте раздел «Платежи».',
        },
        { status: 409 },
      );
    }

    const purchaseRequest = await ensurePendingCoursePurchaseRequest(admin, {
      telegramId,
      packageIndex: 0,
      title: offer.title || courseContent.title,
      amountByn,
      courseSlug,
      scenario: effectiveScenario,
      lessonsCount: offer.lessons,
    });

    const webhookBase = process.env.BEPAY_WEBHOOK_PUBLIC_URL?.trim()
      ? trimTrailingSlash(process.env.BEPAY_WEBHOOK_PUBLIC_URL.trim())
      : siteUrl;

    const checkoutPayload = {
      checkout: {
        test: process.env.BEPAY_TEST === 'true',
        transaction_type: 'payment',
        attempts: 3,
        settings: {
          success_url: `${siteUrl}/cabinet?section=payments&payment=success`,
          fail_url: `${siteUrl}/cabinet?section=payments&payment=failed`,
          notification_url: `${webhookBase}/api/payments/webhook`,
          language: 'ru',
        },
        payment_method: {
          types: ['credit_card'],
        },
        order: {
          currency: 'BYN',
          amount: Math.round(amountByn * 100),
          description: `Курс: ${courseContent.title}`,
          tracking_id: purchaseRequest.id,
          expired_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
        custom_fields: {
          custom_field_1: {
            label: 'Telegram ID',
            value: String(telegramId),
            visible: false,
          },
          ...(effectiveScenario
            ? {
                custom_field_2: {
                  label: 'Scenario',
                  value: effectiveScenario,
                  visible: false,
                },
              }
            : {}),
        },
      },
    };

    if (process.env.NODE_ENV === 'development' && process.env.BEPAY_MOCK === 'true') {
      void recordCheckoutStarted(admin, {
        telegramId,
        courseId: courseId ?? null,
        courseTitle: courseContent.title?.trim() || offer.title || 'Курс',
        purchaseRequestId: purchaseRequest.id,
        scenario: effectiveScenario,
      }).catch((err) => console.error('[create-token mock] checkout notify failed:', err));

      return NextResponse.json({
        redirect_url: `${siteUrl}/cabinet?section=payments&payment=success`,
        mock: true,
      });
    }

    const authHeader = Buffer.from(`${shopId}:${secretKey}`).toString('base64');
    const checkoutUrl = 'https://checkout.bepaid.by/ctp/api/checkouts';

    let response: Response;
    try {
      response = await fetch(checkoutUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-API-Version': '2',
          Authorization: `Basic ${authHeader}`,
        },
        body: JSON.stringify(checkoutPayload),
      });
    } catch (fetchError) {
      console.error('[bePaid create token] network', fetchError);
      return NextResponse.json(
        {
          error:
            'Сервер не смог связаться с bePaid (checkout.bepaid.by). Проверьте интернет, VPN или файрвол.',
        },
        { status: 502 },
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[bePaid create token]', response.status, errorText);
      try {
        await admin
          .from('purchase_requests')
          .update({ status: 'rejected', resolved_at: new Date().toISOString() })
          .eq('id', purchaseRequest.id);
      } catch (updateError) {
        console.error('[bePaid create token] Failed to mark request as rejected:', updateError);
      }
      return NextResponse.json(
        {
          error: `bePaid отклонил создание платежа (${response.status}). Проверьте ключи магазина и тестовый режим BEPAY_TEST.`,
        },
        { status: 502 },
      );
    }

    const data = await response.json();
    const redirectUrl = data?.checkout?.redirect_url as string | undefined;

    if (!redirectUrl) {
      console.error('[bePaid create token] No redirect_url in response', data);
      try {
        await admin
          .from('purchase_requests')
          .update({ status: 'rejected', resolved_at: new Date().toISOString() })
          .eq('id', purchaseRequest.id);
      } catch (updateError) {
        console.error('[bePaid create token] Failed to mark request as rejected:', updateError);
      }
      return NextResponse.json(
        { error: 'bePaid не вернул ссылку на оплату (redirect_url).' },
        { status: 502 },
      );
    }

    void recordCheckoutStarted(admin, {
      telegramId,
      courseId: courseId ?? null,
      courseTitle: courseContent.title?.trim() || offer.title || 'Курс',
      purchaseRequestId: purchaseRequest.id,
      scenario: effectiveScenario,
    }).catch((err) => console.error('[create-token] checkout notify failed:', err));

    return NextResponse.json({ redirect_url: redirectUrl });
  } catch (error) {
    console.error('[bePaid create token] unhandled', error);
    return NextResponse.json({ error: paymentErrorMessage(error) }, { status: 500 });
  }
}
