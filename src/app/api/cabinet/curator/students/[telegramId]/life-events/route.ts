import { NextResponse } from 'next/server';
import { getCuratorAuth } from '@/lib/cabinet-auth';
import { resolveCourseIdForContent } from '@/lib/bot/education/course-record';
import { assertCuratorAssigned } from '@/lib/bot/education/course-homework';
import { getLifeEvents, isLivesTableError } from '@/lib/bot/education/lives';
import { curatorJsonError } from '@/lib/curator/api-errors';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';

type RouteParams = { params: Promise<{ telegramId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
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

    await assertCuratorAssigned(auth.admin, auth.telegramId, studentTelegramId);

    const events = await getLifeEvents(auth.admin, studentTelegramId, courseId, 30);
    return NextResponse.json({
      ok: true,
      events: events.map((e) => ({
        id: e.id,
        delta: e.delta,
        reason: e.reason,
        livesBefore: e.lives_before,
        livesAfter: e.lives_after,
        operationType: e.operation_type,
        createdAt: e.created_at,
        actorTelegramId: e.curator_telegram_id,
      })),
    });
  } catch (error) {
    if (isLivesTableError(error)) {
      return NextResponse.json({ ok: true, events: [] });
    }
    return curatorJsonError(error, 'Failed to load life events');
  }
}
