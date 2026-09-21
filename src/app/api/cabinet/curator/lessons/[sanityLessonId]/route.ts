import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCuratorAuth } from '@/lib/cabinet-auth';
import { curatorJsonError } from '@/lib/curator/api-errors';
import { syncSessionAfterScheduleSave } from '@/lib/curator/lesson-session';
import { patchCourseLesson, type LessonPatchFields } from '@/lib/studio/courseContentWrite';

type RouteParams = { params: Promise<{ sanityLessonId: string }> };

type Body = {
  liveUrl?: string | null;
  recordingUrl?: string | null;
  scheduledAt?: string | null;
  lessonDate?: string | null;
};

export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await getCuratorAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sanityLessonId } = await params;
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const fields: LessonPatchFields = {};
  if (body.liveUrl !== undefined) fields.liveUrl = body.liveUrl?.trim() || null;
  if (body.recordingUrl !== undefined) fields.recordingUrl = body.recordingUrl?.trim() || null;
  if (body.scheduledAt !== undefined) {
    const raw = body.scheduledAt?.trim() || null;
    if (raw && Number.isNaN(Date.parse(raw))) {
      return NextResponse.json({ error: 'Некорректная дата эфира' }, { status: 400 });
    }
    fields.scheduledAt = raw;
  }
  if (body.lessonDate !== undefined) fields.lessonDate = body.lessonDate?.trim() || null;

  try {
    await patchCourseLesson(sanityLessonId, fields);

    const effectiveScheduledAt =
      fields.scheduledAt !== undefined
        ? (fields.scheduledAt ?? null)
        : fields.lessonDate !== undefined
          ? fields.lessonDate
            ? `${fields.lessonDate}T18:00:00+03:00`
            : null
          : undefined;

    if (effectiveScheduledAt !== undefined) {
      try {
        await syncSessionAfterScheduleSave(auth.admin, sanityLessonId, effectiveScheduledAt);
      } catch (syncError) {
        console.warn('[curator-api] session sync after schedule save failed', syncError);
      }
    }
    revalidatePath('/cabinet');
    revalidatePath('/cabinet/curator');
    revalidatePath(`/cabinet/lesson/${sanityLessonId}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return curatorJsonError(error, 'Failed to update lesson');
  }
}
