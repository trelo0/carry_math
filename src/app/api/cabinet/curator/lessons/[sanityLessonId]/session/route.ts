import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCourseDeliveryAuth } from '@/lib/cabinet-auth';
import {
  assertLessonDeliveryAccess,
  readLessonDeliveryCourseHint,
} from '@/lib/curator/staff-course-access';
import { curatorJsonError } from '@/lib/curator/api-errors';
import { findLessonBySanityId } from '@/lib/bot/education/course-homework';
import {
  endSanityLessonSession,
  getSanityLessonSession,
  startSanityLessonSession,
} from '@/lib/curator/lesson-session';
import { notifyStudentsLessonEvent } from '@/lib/curator/lesson-notify';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';

type RouteParams = { params: Promise<{ sanityLessonId: string }> };
type Body = { action?: 'start' | 'end' };

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await getCourseDeliveryAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sanityLessonId } = await params;
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.action !== 'start' && body.action !== 'end') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  try {
    const courseHint = readLessonDeliveryCourseHint(request);
    const course = await assertLessonDeliveryAccess(auth.admin, auth, sanityLessonId, courseHint);
    const content = await getDistrictCourseContent(course.courseSlug);
    const lesson = content ? findLessonBySanityId(content, sanityLessonId) : null;
    if (!lesson) {
      return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
    }

    if (body.action === 'start') {
      if (!lesson.liveUrl?.trim()) {
        return NextResponse.json(
          { error: 'Сначала укажите ссылку на YouTube-трансляцию и сохраните.' },
          { status: 400 },
        );
      }
      const existing = await getSanityLessonSession(auth.admin, course.courseId, sanityLessonId);
      if (existing?.status === 'live') {
        return NextResponse.json({ error: 'Эфир уже идёт.' }, { status: 409 });
      }
      const session = await startSanityLessonSession(
        auth.admin,
        course.courseId,
        sanityLessonId,
        auth.telegramId,
      );
      const notify = await notifyStudentsLessonEvent(auth.admin, sanityLessonId, 'live', {
        courseId: course.courseId,
        courseSlug: course.courseSlug,
      });
      revalidatePath('/cabinet');
      revalidatePath('/cabinet/staff');
      revalidatePath(`/cabinet/lesson/${sanityLessonId}`);
      return NextResponse.json({ ok: true, session, notify });
    }

    const session = await endSanityLessonSession(
      auth.admin,
      course.courseId,
      sanityLessonId,
      auth.telegramId,
    );
    revalidatePath('/cabinet');
    revalidatePath('/cabinet/staff');
    revalidatePath(`/cabinet/lesson/${sanityLessonId}`);
    return NextResponse.json({ ok: true, session });
  } catch (error) {
    return curatorJsonError(error, 'Failed to update session');
  }
}
