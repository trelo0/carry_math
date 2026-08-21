import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isReminderType, runWebinarReminderCheck } from '@/lib/webinarReminders';

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
  const forceParam = url.searchParams.get('force');
  const forcedReminderType = isReminderType(forceParam) ? forceParam : undefined;
  const webinarId = url.searchParams.get('webinar_id');

  if (forceParam && !forcedReminderType) {
    return NextResponse.json(
      { error: 'force must be one of: 3_days, 1_day, 6_hours, 15_minutes' },
      { status: 400 },
    );
  }

  const now = new Date();
  const summary = await runWebinarReminderCheck(createAdminClient(), {
    now,
    forcedReminderType,
    webinarId,
  });

  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    forcedReminderType,
    ...summary,
  });
}
