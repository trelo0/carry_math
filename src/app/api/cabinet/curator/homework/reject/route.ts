import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getHomeworkCheckerAuth } from '@/lib/cabinet-auth';
import { assertStaffCourseCapability } from '@/lib/curator/staff-course-access';
import { hasFullStaffPreview } from '@/lib/bot/roles';
import { rejectCourseHomeworkByCurator } from '@/lib/bot/education/course-homework';
import { notifyStudentHomeworkReviewed } from '@/lib/bot/studentHomeworkFlow';
import { curatorJsonError } from '@/lib/curator/api-errors';

type Body = {
  studentTelegramId?: number;
  lessonNumber?: number;
  note?: string;
  courseId?: number;
};

export async function POST(request: Request) {
  const auth = await getHomeworkCheckerAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.studentTelegramId !== 'number' || typeof body.lessonNumber !== 'number') {
    return NextResponse.json({ error: 'studentTelegramId and lessonNumber required' }, { status: 400 });
  }

  try {
    const { resolveCheckerApiCourse } = await import('@/lib/curator/staff-course-access');
    const course = await resolveCheckerApiCourse(auth.admin, auth.telegramId, body.courseId, {
      roles: auth.roles,
      telegramId: auth.telegramId,
      fullPreview: hasFullStaffPreview(auth.roles, auth.telegramId),
    });
    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    await assertStaffCourseCapability(auth.admin, auth, course.courseId, 'check');

    const { lesson, progress } = await rejectCourseHomeworkByCurator(
      auth.admin,
      auth.telegramId,
      body.studentTelegramId,
      body.lessonNumber,
      body.note,
      { courseId: course.courseId, courseSlug: course.courseSlug },
    );
    await notifyStudentHomeworkReviewed(auth.admin, body.studentTelegramId, {
      lessonNumber: lesson.lessonNumber,
      title: lesson.title,
      approved: false,
      note: progress.review_note ?? body.note,
    });
    revalidatePath('/cabinet');
    revalidatePath('/cabinet/staff');
    revalidatePath(`/cabinet/lesson/${lesson.sanityId}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return curatorJsonError(error, 'Failed to reject homework');
  }
}
