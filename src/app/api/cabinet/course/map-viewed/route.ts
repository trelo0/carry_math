import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordCourseMapFirstView } from '@/lib/bot/admin/user-activity-events';

/** Первое открытие карты курса (идемпотентно, без зачисления). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const phone = (auth.user.user_metadata?.phone as string) ?? auth.user.phone ?? '';

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Server config error' }, { status: 503 });
  }

  const { data: link } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', phone)
    .maybeSingle();
  if (!link?.telegram_id) {
    return NextResponse.json({ error: 'Telegram not linked' }, { status: 403 });
  }

  let courseId: number | null = null;
  try {
    const body = (await request.json()) as { courseId?: unknown };
    if (typeof body.courseId === 'number' && Number.isFinite(body.courseId)) {
      courseId = body.courseId;
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (courseId == null) {
    return NextResponse.json({ error: 'courseId required' }, { status: 400 });
  }

  let courseTitle = 'Курс';
  const { data: courseRow } = await admin.from('courses').select('title').eq('id', courseId).maybeSingle();
  if (courseRow?.title?.trim()) courseTitle = courseRow.title.trim();

  try {
    await recordCourseMapFirstView(admin, link.telegram_id as number, courseId, courseTitle);
  } catch (err) {
    console.error('[course/map-viewed]', err);
  }

  return NextResponse.json({ ok: true });
}
