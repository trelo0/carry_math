import { NextResponse } from 'next/server';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import {
  ADMIN_ACTIVITY_NOTIFICATION_KINDS,
  loadActivityNotificationSettings,
  setActivityNotificationEnabled,
} from '@/lib/bot/admin/user-activity-settings';
import type { AdminUserEventKind } from '@/lib/bot/admin/user-activity-notify';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const settings = await loadActivityNotificationSettings(auth.admin);
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('[activity-notifications GET]', error);
    return NextResponse.json({ error: 'Не удалось загрузить настройки' }, { status: 500 });
  }
}

type PatchBody = { kind?: string; enabled?: boolean };

export async function PATCH(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const kind = body.kind?.trim() as AdminUserEventKind | undefined;
  if (!kind || !ADMIN_ACTIVITY_NOTIFICATION_KINDS.includes(kind)) {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be boolean' }, { status: 400 });
  }

  try {
    await setActivityNotificationEnabled(auth.admin, kind, body.enabled);
    const settings = await loadActivityNotificationSettings(auth.admin);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    console.error('[activity-notifications PATCH]', error);
    const msg = error instanceof Error ? error.message : 'Ошибка сохранения';
    if (msg.includes('admin_activity_notification_settings')) {
      return NextResponse.json(
        { error: 'Примените миграцию admin_activity_notification_settings.sql в Supabase' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
