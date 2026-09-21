import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCuratorAuth } from '@/lib/cabinet-auth';
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
  const auth = await getCuratorAuth();
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

  const content = await getDistrictCourseContent();
  const lesson = content ? findLessonBySanityId(content, sanityLessonId) : null;
  if (!lesson) {
    return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  }

  try {
    if (body.action === 'start') {
      if (!lesson.liveUrl?.trim()) {
        return NextResponse.json(
          { error: 'Сначала укажите ссылку на YouTube-трансляцию и сохраните.' },
          { status: 400 },
        );
      }
      const existing = await getSanityLessonSession(auth.admin, sanityLessonId);
      if (existing?.status === 'live') {
        return NextResponse.json({ error: 'Эфир уже идёт.' }, { status: 409 });
      }
      const session = await startSanityLessonSession(auth.admin, sanityLessonId, auth.telegramId);
      const notify = await notifyStudentsLessonEvent(auth.admin, sanityLessonId, 'live');
      revalidatePath('/cabinet');
      revalidatePath('/cabinet/curator');
      revalidatePath(`/cabinet/lesson/${sanityLessonId}`);
      return NextResponse.json({ ok: true, session, notify });
    }

    const session = await endSanityLessonSession(auth.admin, sanityLessonId, auth.telegramId);
    revalidatePath('/cabinet');
    revalidatePath('/cabinet/curator');
    revalidatePath(`/cabinet/lesson/${sanityLessonId}`);
    return NextResponse.json({ ok: true, session });
  } catch (error) {
    return curatorJsonError(error, 'Failed to update session');
  }
}
