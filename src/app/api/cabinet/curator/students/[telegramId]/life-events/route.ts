import { NextResponse } from 'next/server';
import { getStaffAuth } from '@/lib/cabinet-auth';
import {
  assertStaffStudentCourseView,
  memberCanDeliverCourse,
  memberCanReviewHomework,
} from '@/lib/curator/staff-course-access';
import { getLifeEvents, isLivesTableError } from '@/lib/bot/education/lives';
import { curatorJsonError } from '@/lib/curator/api-errors';
import { resolveStaffStudentCourseId } from '@/lib/curator/resolve-staff-student-course';

type RouteParams = { params: Promise<{ telegramId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const auth = await getStaffAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (
    !memberCanReviewHomework(auth.roles, auth.telegramId) &&
    !memberCanDeliverCourse(auth.roles, auth.telegramId)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { telegramId: rawId } = await params;
  const studentTelegramId = Number(rawId);
  if (!Number.isSafeInteger(studentTelegramId)) {
    return NextResponse.json({ error: 'Invalid student id' }, { status: 400 });
  }

  try {
    const url = new URL(request.url);
    const courseIdRaw = url.searchParams.get('courseId');
    const parsedId =
      courseIdRaw != null && courseIdRaw !== '' ? Number(courseIdRaw) : Number.NaN;
    const courseId = await resolveStaffStudentCourseId(
      auth.admin,
      auth,
      studentTelegramId,
      {
        courseId: Number.isFinite(parsedId) && parsedId > 0 ? parsedId : null,
        courseSlug: url.searchParams.get('course'),
      },
    );
    if (courseId == null) {
      return NextResponse.json(
        { error: 'Укажите courseId или course=slug (несколько курсов у ученика).' },
        { status: 400 },
      );
    }

    await assertStaffStudentCourseView(auth.admin, auth, studentTelegramId, courseId);

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
