import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCuratorAuth } from '@/lib/cabinet-auth';
import { rejectCourseHomeworkByCurator } from '@/lib/bot/education/course-homework';
import { notifyStudentHomeworkReviewed } from '@/lib/bot/studentHomeworkFlow';
import { curatorJsonError } from '@/lib/curator/api-errors';

type Body = {
  studentTelegramId?: number;
  lessonNumber?: number;
  note?: string;
};

export async function POST(request: Request) {
  const auth = await getCuratorAuth();
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
    const { lesson, progress } = await rejectCourseHomeworkByCurator(
      auth.admin,
      auth.telegramId,
      body.studentTelegramId,
      body.lessonNumber,
      body.note,
    );
    await notifyStudentHomeworkReviewed(auth.admin, body.studentTelegramId, {
      lessonNumber: lesson.lessonNumber,
      title: lesson.title,
      approved: false,
      note: progress.review_note ?? body.note,
    });
    revalidatePath('/cabinet');
    revalidatePath('/cabinet/curator');
    revalidatePath(`/cabinet/lesson/${lesson.sanityId}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return curatorJsonError(error, 'Failed to reject homework');
  }
}
