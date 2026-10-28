import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createCtaIntent, CTA_INTENT_COOKIE } from '@/lib/bot/admin/user-activity-events';

type Body = { source?: string };

const ALLOWED = new Set(['home_hero', 'home_initiation']);

/** Фиксирует клик CTA на главной (до авторизации). */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const source = body.source?.trim();
  if (!source || !ALLOWED.has(source)) {
    return NextResponse.json({ error: 'Invalid source' }, { status: 400 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Server config error' }, { status: 503 });
  }

  const created = await createCtaIntent(admin, source as 'home_hero' | 'home_initiation');
  if (!created) {
    return NextResponse.json({ ok: true, stored: false });
  }

  const response = NextResponse.json({ ok: true, stored: true });
  response.cookies.set(CTA_INTENT_COOKIE, created.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
  return response;
}
