import { NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { syncBePaidJournal } from '@/lib/bepaid/journal';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ALLOWED_DAYS = new Set([7, 30, 31, 90, 365]);

/** Ручная синхронизация журнала с bePaid Reports API (идемпотентно). */
export async function POST(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let days = 7;
  try {
    const body = (await request.json()) as { days?: number };
    if (typeof body.days === 'number' && ALLOWED_DAYS.has(body.days)) days = body.days;
  } catch {
    // дефолт 7 дней
  }

  try {
    const summary = await syncBePaidJournal(auth.admin, days);
    revalidateTag('admin-finance', { expire: 0 });
    revalidatePath('/cabinet/admin/finance');
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    console.error('[admin journal sync]', error);
    const message = error instanceof Error ? error.message : 'Не удалось синхронизировать';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
