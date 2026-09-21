import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCuratorAuth } from '@/lib/cabinet-auth';
import { resolveCourseIdForContent } from '@/lib/bot/education/course-record';
import { grantBonusLife } from '@/lib/bot/education/lives';
import { curatorJsonError } from '@/lib/curator/api-errors';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';

type RouteParams = { params: Promise<{ telegramId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  const auth = await getCuratorAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { telegramId: rawId } = await params;
  const studentTelegramId = Number(rawId);
  if (!Number.isSafeInteger(studentTelegramId)) {
    return NextResponse.json({ error: 'Invalid student id' }, { status: 400 });
  }

  try {
    const content = await getDistrictCourseContent();
    const courseId = content ? await resolveCourseIdForContent(auth.admin, content) : null;
    if (!courseId) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    const state = await grantBonusLife(auth.admin, {
      telegramId: studentTelegramId,
      courseId,
      curatorTelegramId: auth.telegramId,
      reason: 'Восстановление куратором',
    });

    revalidatePath('/cabinet');
    revalidatePath('/cabinet/curator');
    return NextResponse.json({ ok: true, livesCurrent: state.lives_current, livesMax: state.lives_max });
  } catch (error) {
    return curatorJsonError(error, 'Failed to restore life');
  }
}
