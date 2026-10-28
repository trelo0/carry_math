import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  consumeCtaIntentOnCabinetEntry,
  CTA_INTENT_COOKIE,
} from '@/lib/bot/admin/user-activity-events';

/** Завершение CTA-пути для уже авторизованного входа в кабинет. */
export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const phone =
    (auth.user.user_metadata?.phone as string) ?? auth.user.phone ?? '';
  if (!phone.trim()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Server config error' }, { status: 503 });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(CTA_INTENT_COOKIE)?.value ?? null;
  if (!token) {
    return NextResponse.json({ ok: true, consumed: false });
  }

  const response = NextResponse.json({ ok: true, consumed: true });
  try {
    await consumeCtaIntentOnCabinetEntry(admin, {
      userId: auth.user.id,
      phone,
      ctaIntentToken: token,
      clearCookieResponse: response,
    });
  } catch (error) {
    console.error('[consume-cta-intent]', error);
  }
  return response;
}
