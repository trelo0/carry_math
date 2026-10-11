import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCuratorAuth } from '@/lib/cabinet-auth';
import { resolveCourseIdForContent } from '@/lib/bot/education/course-record';
import { assertCuratorAssigned } from '@/lib/bot/education/course-homework';
import { unfreezeEnrollment } from '@/lib/bot/education/lives';
import { curatorJsonError } from '@/lib/curator/api-errors';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';

type RouteParams = { params: Promise<{ telegramId: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await getCuratorAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { telegramId: rawId } = await params;
  const studentTelegramId = Number(rawId);
  if (!Number.isSafeInteger(studentTelegramId)) {
    return NextResponse.json({ error: 'Invalid student id' }, { status: 400 });
  }

  let reason = 'Разморозка куратором';
  try {
    const body = (await request.json()) as { reason?: string };
    if (body.reason?.trim()) reason = body.reason.trim();
  } catch {
    /* optional body */
  }

  try {
    const content = await getDistrictCourseContent();
    const courseId = content ? await resolveCourseIdForContent(auth.admin, content) : null;
    if (!courseId) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    await assertCuratorAssigned(auth.admin, auth.telegramId, studentTelegramId);

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
