import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCourseDeliveryAuth } from '@/lib/cabinet-auth';
import { assertStaffCourseCapability } from '@/lib/curator/staff-course-access';
import { assertCuratorAssigned } from '@/lib/bot/education/course-homework';
import { unfreezeEnrollment } from '@/lib/bot/education/lives';
import { curatorJsonError } from '@/lib/curator/api-errors';

type RouteParams = { params: Promise<{ telegramId: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await getCourseDeliveryAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { telegramId: rawId } = await params;
  const studentTelegramId = Number(rawId);
  if (!Number.isSafeInteger(studentTelegramId)) {
    return NextResponse.json({ error: 'Invalid student id' }, { status: 400 });
  }

  let reason = 'Разморозка куратором';
  let bodyCourseId: number | undefined;
  try {
    const body = (await request.json()) as { reason?: string; courseId?: number };
    if (body.reason?.trim()) reason = body.reason.trim();
    if (typeof body.courseId === 'number') bodyCourseId = body.courseId;
  } catch {
    /* optional body */
  }

  try {
    const { resolveCuratorApiCourse } = await import('@/lib/curator/api-course');
    const course = await resolveCuratorApiCourse(auth.admin, auth.telegramId, bodyCourseId);
    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    const courseId = course.courseId;

    await assertStaffCourseCapability(auth.admin, auth, courseId, 'curator');
    await assertCuratorAssigned(auth.admin, auth.telegramId, studentTelegramId, { courseId });

    const state = await unfreezeEnrollment(auth.admin, {
      telegramId: studentTelegramId,
      courseId,
      actorTelegramId: auth.telegramId,
      reason,
    });

    revalidatePath('/cabinet');
    revalidatePath('/cabinet/staff');
    return NextResponse.json({
      ok: true,
      accessBlocked: state.access_blocked,
      livesCurrent: state.lives_current,
      livesMax: state.lives_max,
    });
  } catch (error) {
    return curatorJsonError(error, 'Failed to unfreeze');
  }
}
