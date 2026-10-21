import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureMember } from '@/lib/bot/roles';
import { lookupCourseIdsBySlugs } from '@/lib/bot/education/course-record';
import { isStudentOnCourse } from '@/lib/bot/education/student-course-context';

type EnrollBody = { course?: string; courseSlug?: string };

/** Открывает карту курса в кабинете (без зачисления и без выдачи доступа). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const phone = (auth.user.user_metadata?.phone as string) ?? auth.user.phone ?? '';

  let body: EnrollBody = {};
  try {
    body = (await request.json()) as EnrollBody;
  } catch {
    /* optional body */
  }
  const courseSlug = (body.course ?? body.courseSlug)?.trim() || null;

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

  if (!courseSlug) {
    return NextResponse.json({ error: 'Укажите course (slug курса).' }, { status: 400 });
  }

  const idBySlug = await lookupCourseIdsBySlugs(admin, [courseSlug]);
  const courseId = idBySlug.get(courseSlug);
  if (courseId == null) {
    return NextResponse.json({ error: 'Курс не найден.' }, { status: 404 });
  }

  const enrolled = await isStudentOnCourse(admin, telegramId, courseId);
  if (!enrolled) {
    return NextResponse.json({ error: 'Нет активного зачисления на этот курс.' }, { status: 403 });
  }

  const { error: stateError } = await admin.from('course_enrollment_state').upsert(
    {
      telegram_id: telegramId,
      course_id: courseId,
      map_viewed_at: now,
      updated_at: now,
    },
    { onConflict: 'telegram_id,course_id' },
  );

  if (stateError) {
    const message = String(stateError.message ?? stateError);
    if (message.includes('map_viewed_at')) {
      const { error } = await admin.from('student_profiles').upsert(
        {
          telegram_id: telegramId,
          course_map_viewed_at: now,
          updated_at: now,
        },
        { onConflict: 'telegram_id' },
      );
      if (error) {
        return NextResponse.json({ error: message }, { status: 503 });
      }
    } else {
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  await admin.from('student_profiles').upsert(
    {
      telegram_id: telegramId,
      course_map_viewed_at: now,
      updated_at: now,
    },
    { onConflict: 'telegram_id' },
  );

  await ensureMember(admin, telegramId, {}, 'student');
  revalidatePath('/cabinet');
  return NextResponse.json({ ok: true, courseId });
}
