import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCabinetAuth } from '@/lib/cabinet-auth';
import { CourseHomeworkError, markHomeworkSubmitted } from '@/lib/bot/education/course-homework';
import { notifyCuratorHomeworkSubmitted } from '@/lib/curator/homework-events';

type RouteParams = { params: Promise<{ sanityLessonId: string }> };

type Body = {
  note?: string;
  fileUrl?: string;
};

export async function POST(request: Request, { params }: RouteParams) {
  const secret = process.env.PURCHASE_FULFILL_SECRET;
  const headerSecret = request.headers.get('x-fulfill-secret');
  const isSecretCall = Boolean(secret && headerSecret === secret);

  const { sanityLessonId } = await params;
  if (!sanityLessonId) {
    return NextResponse.json({ error: 'Missing lesson id' }, { status: 400 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    if (isSecretCall) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
  }

  let telegramId: number | null = null;
  let admin;

  if (isSecretCall) {
    const rawTelegram = (body as Body & { telegramId?: number }).telegramId;
    if (typeof rawTelegram !== 'number') {
      return NextResponse.json({ error: 'telegramId required for secret call' }, { status: 400 });
    }
    telegramId = rawTelegram;
    const { createAdminClient } = await import('@/lib/supabase/admin');
    admin = createAdminClient();
  } else {
    const auth = await getCabinetAuth();
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    telegramId = auth.telegramId;
    admin = auth.admin;
  }

  try {
    const submitInput = { note: body.note, fileUrl: body.fileUrl };
    const progress = await markHomeworkSubmitted(admin, telegramId, sanityLessonId, submitInput);
    await notifyCuratorHomeworkSubmitted(admin, telegramId, sanityLessonId, submitInput);
    try {
      const { resolveCourseForSanityLesson } = await import(
        '@/lib/bot/education/student-course-context'
      );
      const { findLessonBySanityId } = await import('@/lib/bot/education/course-homework');
      const { notifyStudentHomeworkSubmitted } = await import('@/lib/bot/student-push-notify');
      const resolved = await resolveCourseForSanityLesson(admin, telegramId, sanityLessonId);
      const lesson = resolved ? findLessonBySanityId(resolved.content, sanityLessonId) : null;
      if (lesson) {
        await notifyStudentHomeworkSubmitted(admin, telegramId, {
          lessonNumber: lesson.lessonNumber,
          title: lesson.title,
          sanityLessonId,
        });
      }
    } catch (pushErr) {
      console.error('[homework/submit] student push failed:', pushErr);
    }
    revalidatePath('/cabinet');
    revalidatePath('/cabinet/staff');
    return NextResponse.json({ ok: true, progress });
  } catch (error) {
    if (error instanceof CourseHomeworkError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    console.error('[homework/submit]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
