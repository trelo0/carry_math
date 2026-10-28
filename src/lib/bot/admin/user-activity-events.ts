import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextResponse } from 'next/server';
import { purchaseScenarioLabel } from '@/lib/course-purchase-scenario';
import {
  CTA_SOURCE_LABELS,
  formatAdminUserActivityHtml,
  resolveActivityUserDisplay,
  sendAdminUserActivityTelegram,
  type ActivityNotifyPayload,
  type AdminUserEventKind,
} from './user-activity-notify';

export const CTA_INTENT_COOKIE = 'district_cta_intent';
const CTA_INTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type RecordInput = {
  kind: AdminUserEventKind;
  dedupeKey: string;
  userId?: string | null;
  telegramId?: number | null;
  courseId?: number | null;
  source?: string | null;
  payload?: Record<string, unknown>;
  notify?: ActivityNotifyPayload;
};

function isMissingTableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('admin_user_events') || msg.includes('does not exist');
}

/** Идемпотентная запись + Telegram (ошибки Telegram не пробрасываем). */
export async function recordAdminUserActivityEvent(
  admin: SupabaseClient,
  input: RecordInput,
): Promise<{ inserted: boolean; eventId?: number }> {
  const occurredAt = new Date().toISOString();
  const notify = input.notify;
  const payload = {
    ...(input.payload ?? {}),
    ...(notify?.courseTitle?.trim() ? { courseTitle: notify.courseTitle.trim() } : {}),
    ...(notify?.lessonTitle?.trim() ? { lessonTitle: notify.lessonTitle.trim() } : {}),
    ...(notify?.checkoutAction?.trim() ? { checkoutAction: notify.checkoutAction.trim() } : {}),
    ...(notify?.scenarioLabel?.trim() ? { scenarioLabel: notify.scenarioLabel.trim() } : {}),
    ...(notify?.amountByn != null && notify.amountByn > 0 ? { amountByn: notify.amountByn } : {}),
    ...(notify?.sourceLabel?.trim() ? { sourceLabel: notify.sourceLabel.trim() } : {}),
  };
  const row = {
    kind: input.kind,
    user_id: input.userId ?? null,
    telegram_id: input.telegramId ?? null,
    course_id: input.courseId ?? null,
    source: input.source ?? null,
    payload,
    dedupe_key: input.dedupeKey,
    occurred_at: occurredAt,
  };

  const { data, error } = await admin.from('admin_user_events').insert(row).select('id').single();

  if (error) {
    if (error.code === '23505') return { inserted: false };
    if (isMissingTableError(error)) {
      console.warn('[user-activity] admin_user_events missing — apply admin_user_events.sql');
      return { inserted: false };
    }
    throw error;
  }

  const eventId = data?.id as number | undefined;
  const notifyPayload = input.notify ?? {
    kind: input.kind,
    occurredAt,
  };

  try {
    const { isAdminActivityNotificationEnabled } = await import('./user-activity-settings');
    const enabled = await isAdminActivityNotificationEnabled(admin, input.kind);
    if (!enabled) {
      if (eventId != null) {
        try {
          await admin
            .from('admin_user_events')
            .update({
              payload: {
                ...payload,
                telegram_skipped: 'disabled_in_settings',
              },
            })
            .eq('id', eventId);
        } catch {
          /* audit marker optional */
        }
      }
      return { inserted: true, eventId };
    }

    const { displayName, contactHint } = await resolveActivityUserDisplay(
      admin,
      input.telegramId ?? null,
      input.userId ?? null,
    );
    const textHtml = formatAdminUserActivityHtml({
      ...notifyPayload,
      occurredAt: notifyPayload.occurredAt ?? occurredAt,
      userDisplayName: notifyPayload.userDisplayName ?? displayName,
      contactHint: notifyPayload.contactHint ?? contactHint,
    });
    const sent = await sendAdminUserActivityTelegram(admin, {
      textHtml,
      clientTelegramId: input.telegramId ?? null,
      contactFallback: contactHint,
    });
    if (sent && eventId != null) {
      await admin
        .from('admin_user_events')
        .update({ telegram_notified_at: new Date().toISOString() })
        .eq('id', eventId);
    }
  } catch (notifyErr) {
    console.error('[user-activity] notify failed:', notifyErr);
  }

  return { inserted: true, eventId };
}

export async function createCtaIntent(
  admin: SupabaseClient,
  source: 'home_hero' | 'home_initiation',
): Promise<{ token: string } | null> {
  const expiresAt = new Date(Date.now() + CTA_INTENT_TTL_MS).toISOString();
  const { data, error } = await admin
    .from('cta_intents')
    .insert({ source, expires_at: expiresAt })
    .select('token')
    .single();
  if (error) {
    if (String(error.message).includes('cta_intents')) {
      console.warn('[user-activity] cta_intents missing');
      return null;
    }
    throw error;
  }
  return { token: data.token as string };
}

function clearCtaCookie(response: NextResponse): void {
  response.cookies.set(CTA_INTENT_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/** После успешной авторизации: CTA + первый/повторный вход. */
export async function handleCabinetAuthActivity(
  admin: SupabaseClient,
  params: {
    userId: string;
    phone: string;
    authDedupeRef: string;
  },
): Promise<void> {
  const { data: link } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', params.phone)
    .maybeSingle();
  const telegramId = (link?.telegram_id as number | null) ?? null;

  const occurredAt = new Date().toISOString();

  const first = await recordAdminUserActivityEvent(admin, {
    kind: 'first_cabinet_login',
    dedupeKey: `first_login:${params.userId}`,
    userId: params.userId,
    telegramId,
    notify: {
      kind: 'first_cabinet_login',
      occurredAt,
    },
  });

  if (!first.inserted) {
    await recordAdminUserActivityEvent(admin, {
      kind: 'cabinet_login',
      dedupeKey: `login:${params.userId}:${params.authDedupeRef}`,
      userId: params.userId,
      telegramId,
      notify: {
        kind: 'cabinet_login',
        occurredAt,
      },
    });
  }

  // CTA завершается при загрузке /cabinet (consume-cta-intent), не при выдаче сессии.
}

export async function consumeCtaIntentOnCabinetEntry(
  admin: SupabaseClient,
  params: {
    userId: string;
    phone: string;
    ctaIntentToken?: string | null;
    clearCookieResponse?: NextResponse;
  },
): Promise<void> {
  const { data: link } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', params.phone)
    .maybeSingle();
  const telegramId = (link?.telegram_id as number | null) ?? null;
  const { displayName, contactHint } = await resolveActivityUserDisplay(
    admin,
    telegramId,
    params.userId,
  );
  await consumeCtaIntentAfterAuth(admin, {
    userId: params.userId,
    telegramId,
    token: params.ctaIntentToken,
    displayName,
    contactHint,
    clearCookieResponse: params.clearCookieResponse,
  });
}

async function consumeCtaIntentAfterAuth(
  admin: SupabaseClient,
  params: {
    userId: string;
    telegramId: number | null;
    token?: string | null;
    displayName: string;
    contactHint: string | null;
    clearCookieResponse?: NextResponse;
  },
): Promise<void> {
  const token = params.token?.trim();
  if (!token) return;

  const now = new Date().toISOString();
  const { data: intent, error } = await admin
    .from('cta_intents')
    .select('token, source, consumed_at, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (error || !intent || intent.consumed_at) {
    if (params.clearCookieResponse) clearCtaCookie(params.clearCookieResponse);
    return;
  }
  if (new Date(intent.expires_at as string).getTime() < Date.now()) {
    if (params.clearCookieResponse) clearCtaCookie(params.clearCookieResponse);
    return;
  }

  const { data: consumedRow, error: consumeError } = await admin
    .from('cta_intents')
    .update({ consumed_at: now, user_id: params.userId })
    .eq('token', token)
    .is('consumed_at', null)
    .select('source')
    .maybeSingle();
  if (consumeError || !consumedRow) {
    if (params.clearCookieResponse) clearCtaCookie(params.clearCookieResponse);
    return;
  }

  const source = consumedRow.source as string;
  const sourceLabel = CTA_SOURCE_LABELS[source] ?? source;

  await recordAdminUserActivityEvent(admin, {
    kind: 'cta_course_signup',
    dedupeKey: `cta:${source}:${params.userId}:${token}`,
    userId: params.userId,
    telegramId: params.telegramId,
    source,
    notify: {
      kind: 'cta_course_signup',
      occurredAt: now,
      userDisplayName: params.displayName,
      contactHint: params.contactHint,
      sourceLabel,
    },
  });

  if (params.clearCookieResponse) clearCtaCookie(params.clearCookieResponse);
}

export async function recordCourseMapFirstView(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  courseTitle: string,
): Promise<void> {
  const { error } = await admin.from('student_course_map_first_view').insert({
    telegram_id: telegramId,
    course_id: courseId,
  });
  if (error) {
    if (error.code === '23505') return;
    if (String(error.message).includes('student_course_map_first_view')) {
      console.warn('[user-activity] student_course_map_first_view missing');
      return;
    }
    throw error;
  }

  const { data: link } = await admin
    .from('telegram_links')
    .select('user_id')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  await recordAdminUserActivityEvent(admin, {
    kind: 'course_map_first_view',
    dedupeKey: `course_map:${telegramId}:${courseId}`,
    userId: (link?.user_id as string | null) ?? null,
    telegramId,
    courseId,
    notify: {
      kind: 'course_map_first_view',
      occurredAt: new Date().toISOString(),
      courseTitle,
    },
  });
}

export async function recordTrialLessonFirstView(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number | null,
  sanityLessonId: string,
  courseTitle: string,
  lessonTitle: string | null,
): Promise<void> {
  const { data: link } = await admin
    .from('telegram_links')
    .select('user_id')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  await recordAdminUserActivityEvent(admin, {
    kind: 'trial_lesson_first_view',
    dedupeKey: `trial:${telegramId}:${sanityLessonId}`,
    userId: (link?.user_id as string | null) ?? null,
    telegramId,
    courseId,
    payload: { sanity_lesson_id: sanityLessonId },
    notify: {
      kind: 'trial_lesson_first_view',
      occurredAt: new Date().toISOString(),
      courseTitle,
      lessonTitle,
    },
  });
}

export async function recordCheckoutStarted(
  admin: SupabaseClient,
  params: {
    telegramId: number;
    courseId: number | null;
    courseTitle: string;
    purchaseRequestId: string;
    scenario: 'start_from_beginning' | 'join_current' | null;
  },
): Promise<void> {
  const { data: link } = await admin
    .from('telegram_links')
    .select('user_id')
    .eq('telegram_id', params.telegramId)
    .maybeSingle();

  await recordAdminUserActivityEvent(admin, {
    kind: 'checkout_started',
    dedupeKey: `checkout:${params.purchaseRequestId}`,
    userId: (link?.user_id as string | null) ?? null,
    telegramId: params.telegramId,
    courseId: params.courseId,
    payload: { purchase_request_id: params.purchaseRequestId },
    notify: {
      kind: 'checkout_started',
      occurredAt: new Date().toISOString(),
      courseTitle: params.courseTitle,
      checkoutAction: 'Покупка курса',
      scenarioLabel: purchaseScenarioLabel(params.scenario),
    },
  });
}

export async function recordCoursePurchasePaid(
  admin: SupabaseClient,
  params: {
    purchaseRequestId: string;
    telegramId: number;
    courseId: number | null;
    courseTitle: string;
    scenario: 'start_from_beginning' | 'join_current' | null;
    amountByn: number;
    paidAt: string;
  },
): Promise<void> {
  const { displayName, contactHint } = await resolveActivityUserDisplay(
    admin,
    params.telegramId,
    null,
  );
  const { data: link } = await admin
    .from('telegram_links')
    .select('user_id')
    .eq('telegram_id', params.telegramId)
    .maybeSingle();

  await recordAdminUserActivityEvent(admin, {
    kind: 'course_purchase_paid',
    dedupeKey: `purchase_paid:${params.purchaseRequestId}`,
    userId: (link?.user_id as string | null) ?? null,
    telegramId: params.telegramId,
    courseId: params.courseId,
    payload: { purchase_request_id: params.purchaseRequestId },
    notify: {
      kind: 'course_purchase_paid',
      occurredAt: params.paidAt,
      userDisplayName: displayName,
      payerName: displayName,
      studentName: displayName,
      contactHint,
      courseTitle: params.courseTitle,
      scenarioLabel: purchaseScenarioLabel(params.scenario),
      amountByn: params.amountByn,
      currency: 'BYN',
    },
  });
}
