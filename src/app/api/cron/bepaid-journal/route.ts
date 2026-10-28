import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncBePaidJournal } from '@/lib/bepaid/journal';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

/** Подтягивает последние транзакции bePaid (страховка на случай пропущенных уведомлений). */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const days = Math.min(30, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 3));
  try {
    const summary = await syncBePaidJournal(createAdminClient(), days);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    console.error('[cron bepaid-journal]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
