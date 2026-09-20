import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureMember } from '@/lib/bot/roles';
import { enrollStudent, getActiveCourses } from '@/lib/bot/education/courses';
import { resolveCourseIdForContent } from '@/lib/bot/education/course-record';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const phone = (auth.user.user_metadata?.phone as string) ?? auth.user.phone ?? '';
  const body = await request.json().catch(() => null);
  const courseId =
    body && typeof body === 'object' && typeof body.courseId === 'number'
      ? body.courseId
      : undefined;

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

  let targetCourseId = courseId;
  if (!targetCourseId) {
    const courses = await getActiveCourses(admin);
    targetCourseId = courses[0]?.id;
  }
  if (!targetCourseId) {
    return NextResponse.json({ error: 'No active course' }, { status: 404 });
  }

  try {
    const courseContent = await getDistrictCourseContent().catch(() => null);
    await resolveCourseIdForContent(admin, courseContent);
    await ensureMember(admin, link.telegram_id as number, {}, 'student');
    const enrollment = await enrollStudent(admin, link.telegram_id as number, targetCourseId);
    revalidatePath('/cabinet');
    return NextResponse.json({
      ok: true,
      courseId: enrollment.course_id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Enrollment failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
