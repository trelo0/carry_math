import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCabinetAuth } from '@/lib/cabinet-auth';
import {
  CourseWatchDeniedError,
  watchRecordingWithAccessGate,
} from '@/lib/bot/education/course-watch-gate';

type RouteParams = { params: Promise<{ sanityLessonId: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await getCabinetAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sanityLessonId } = await params;
  if (!sanityLessonId) {
    return NextResponse.json({ error: 'Missing lesson id' }, { status: 400 });
  }

  let watchPercent: number | undefined;
  try {
    const body = (await request.json()) as { watchPercent?: number };
    if (typeof body.watchPercent === 'number') watchPercent = body.watchPercent;
  } catch {
    /* body optional */
  }

  try {
    await watchRecordingWithAccessGate(auth.admin, auth.telegramId, sanityLessonId, watchPercent);
    // Только страница урока — полный /cabinet рефетчить не надо (тормозит навигацию)
    revalidatePath(`/cabinet/lesson/${sanityLessonId}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CourseWatchDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : 'Progress update failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
