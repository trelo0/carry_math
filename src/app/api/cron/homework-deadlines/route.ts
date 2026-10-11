import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runHomeworkDeadlineReminders } from '@/lib/bot/education/homework-deadline-notify';

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

  const now = new Date();
  const summary = await runHomeworkDeadlineReminders(createAdminClient(), now);

  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    ...summary,
  });
}

export async function POST(request: Request) {
  return GET(request);
}
