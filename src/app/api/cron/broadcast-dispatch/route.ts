import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runBroadcastDispatch } from '@/lib/bot/admin/broadcast-jobs';

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
  const maxMessages = Math.min(120, Math.max(5, Number(url.searchParams.get('max')) || 40));

  const summary = await runBroadcastDispatch(createAdminClient(), { maxMessages });

  return NextResponse.json({
    ok: true,
    ...summary,
  });
}
