import { NextResponse } from 'next/server';
import { getCabinetAuth } from '@/lib/cabinet-auth';
import { flattenCourseLessons, getDistrictCourseContent } from '@/lib/studio/courseContent';
import { resolveCourseForSanityLesson } from '@/lib/bot/education/student-course-context';
import { recordTrialLessonFirstView } from '@/lib/bot/admin/user-activity-events';

type RouteParams = { params: Promise<{ sanityLessonId: string }> };

/** Первый заход на пробное занятие (страница / без видео). */
export async function POST(_request: Request, { params }: RouteParams) {
  const auth = await getCabinetAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sanityLessonId } = await params;
  if (!sanityLessonId) {
    return NextResponse.json({ error: 'Missing lesson id' }, { status: 400 });
  }

  const resolved = await resolveCourseForSanityLesson(auth.admin, auth.telegramId, sanityLessonId);
  const content = resolved?.content ?? (await getDistrictCourseContent().catch(() => null));
  if (!content) {
    return NextResponse.json({ error: 'Course not found' }, { status: 404 });
  }

  const lesson = flattenCourseLessons(content).find((l) => l.sanityId === sanityLessonId);
  if (!lesson?.isTrialFree) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const courseId = resolved?.courseId ?? null;
  const courseTitle = content.title?.trim() || 'Курс';
  const lessonTitle = lesson.title?.trim() || null;

  try {
    await recordTrialLessonFirstView(
      auth.admin,
      auth.telegramId,
      courseId,
      sanityLessonId,
      courseTitle,
      lessonTitle,
    );
  } catch (error) {
    console.error('[trial-view]', error);
  }

  return NextResponse.json({ ok: true });
}
