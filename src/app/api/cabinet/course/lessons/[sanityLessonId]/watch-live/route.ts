import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCabinetAuth } from '@/lib/cabinet-auth';
import { markLiveAttended } from '@/lib/bot/education/course-progress';

type RouteParams = { params: Promise<{ sanityLessonId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  const auth = await getCabinetAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sanityLessonId } = await params;
  if (!sanityLessonId) {
    return NextResponse.json({ error: 'Missing lesson id' }, { status: 400 });
  }

  try {
    await markLiveAttended(auth.admin, auth.telegramId, { sanityLessonId });
    revalidatePath('/cabinet');
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Progress update failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
