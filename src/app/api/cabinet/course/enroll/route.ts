import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureMember } from '@/lib/bot/roles';
import { recordCourseMapFirstView } from '@/lib/bot/admin/user-activity-events';

/** Открывает карту курса в кабинете (без зачисления и без выдачи доступа). */
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

  const telegramId = link.telegram_id as number;
  const now = new Date().toISOString();

  let courseId: number | null = null;
  try {
    const body = (await request.json()) as { courseId?: unknown };
    if (typeof body.courseId === 'number' && Number.isFinite(body.courseId)) {
      courseId = body.courseId;
    }
  } catch {
    // пустое тело — ок
  }

  const { error: profileError } = await admin.from('student_profiles').upsert(
    {
      telegram_id: telegramId,
      course_map_viewed_at: now,
      updated_at: now,
    },
    { onConflict: 'telegram_id' },
  );

  if (profileError) {
    const message = String(profileError.message ?? profileError);
    if (message.includes('course_map_viewed_at')) {
      return NextResponse.json(
        { error: 'Нужна миграция course_map_viewed.sql в Supabase' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await ensureMember(admin, telegramId, {}, 'student');

  if (courseId != null) {
    let courseTitle = 'Курс';
    const { data: courseRow } = await admin.from('courses').select('title').eq('id', courseId).maybeSingle();
    if (courseRow?.title?.trim()) courseTitle = courseRow.title.trim();
    try {
      await recordCourseMapFirstView(admin, telegramId, courseId, courseTitle);
    } catch (err) {
      console.error('[course/enroll] admin notify failed:', err);
    }
  }

  revalidatePath('/cabinet');
  return NextResponse.json({ ok: true });
}
