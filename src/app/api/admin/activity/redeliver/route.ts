import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { redeliverPendingAdminUserEventNotifications } from '@/lib/bot/admin/user-activity-notify';

export const dynamic = 'force-dynamic';

/** Повторная отправка в Telegram событий без telegram_notified_at (только admin). */
export async function POST() {
  const staff = await getStaffAuth();
  if (!staff || staff.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Server config error' }, { status: 503 });
  }

  const result = await redeliverPendingAdminUserEventNotifications(admin);
  return NextResponse.json({ ok: true, ...result });
}
