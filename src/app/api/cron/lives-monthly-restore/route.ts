import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { moscowPeriodKey, runMonthlyLivesRestore } from '@/lib/bot/education/lives';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const periodKey = url.searchParams.get('period')?.trim() || moscowPeriodKey();

  const summary = await runMonthlyLivesRestore(createAdminClient(), periodKey);

  return NextResponse.json({
    ok: true,
    periodKey,
    ...summary,
  });
}

export async function POST(request: Request) {
  return GET(request);
}
