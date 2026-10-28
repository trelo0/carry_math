import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { COURSE_STUDENTS_TAG } from '@/lib/admin/course-students';
import { logAdminAction } from '@/lib/bot/admin/action-log';
import { adminManualCoursePackageTopUp } from '@/lib/bot/packages';
import { firstRow } from '@/lib/supabase/single-row';

export const dynamic = 'force-dynamic';

type Body = { courseId?: number; telegramId?: number; lessons?: number };

/** POST — вручную пополнить пакет занятий ученика по курсу (если авто-начисление не сработало). */
export async function POST(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }
  const courseId = Number(body.courseId);
  const telegramId = Number(body.telegramId);
  const lessons = Math.floor(Number(body.lessons));
  if (!Number.isFinite(courseId) || !Number.isFinite(telegramId)) {
    return NextResponse.json({ error: 'Не указан курс или ученик' }, { status: 400 });
  }
  if (!Number.isFinite(lessons) || lessons < 1 || lessons > 100) {
    return NextResponse.json({ error: 'Количество занятий: от 1 до 100' }, { status: 400 });
  }

  try {
    const { data: courseRows, error: courseErr } = await auth.admin
      .from('courses')
      .select('slug, title')
      .eq('id', courseId)
      .limit(1);
    if (courseErr) throw courseErr;
    const course = firstRow(courseRows);
    if (!course) return NextResponse.json({ error: 'Курс не найден в базе' }, { status: 404 });

    const { data: pkgRows } = await auth.admin
      .from('lesson_packages')
      .select('title')
      .eq('telegram_id', telegramId)
      .eq('product', 'course')
      .eq('course_id', courseId)
      .eq('status', 'active')
      .order('id', { ascending: false })
      .limit(1);
    const pkgTitle = firstRow(pkgRows)?.title as string | undefined;

    const result = await adminManualCoursePackageTopUp(
      auth.admin,
      telegramId,
      courseId,
      lessons,
      pkgTitle || `Курс: ${String(course.title ?? course.slug)}`,
      String(course.slug),
      auth.telegramId,
    );

    await logAdminAction(auth.admin, {
      actorTelegramId: auth.telegramId,
      action: 'course.package_topup',
      entityType: 'course',
      entityId: courseId,
      targetTelegramId: telegramId,
      detail: {
        lessons,
        packageId: result.packageId,
        lessonsGranted: result.lessonsGranted,
        unlockWarning: result.unlockWarning,
      },
    });
    revalidateTag(COURSE_STUDENTS_TAG, { expire: 0 });

    return NextResponse.json({
      ok: true,
      packageId: result.packageId,
      lessonsGranted: result.lessonsGranted,
      warning: result.unlockWarning,
    });
  } catch (error) {
    console.error('[admin course student package]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось пополнить пакет' },
      { status: 500 },
    );
  }
}
