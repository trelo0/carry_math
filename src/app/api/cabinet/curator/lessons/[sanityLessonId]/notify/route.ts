import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCuratorAuth } from '@/lib/cabinet-auth';
import { curatorJsonError } from '@/lib/curator/api-errors';
import { notifyStudentsLessonEvent, type LessonNotifyType } from '@/lib/curator/lesson-notify';

type RouteParams = { params: Promise<{ sanityLessonId: string }> };

type Body = { type?: LessonNotifyType };

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

  if (body.type !== 'live' && body.type !== 'materials' && body.type !== 'recording') {
    return NextResponse.json({ error: 'Invalid notify type' }, { status: 400 });
  }

  try {
    const result = await notifyStudentsLessonEvent(auth.admin, sanityLessonId, body.type);
    revalidatePath('/cabinet');
    revalidatePath(`/cabinet/lesson/${sanityLessonId}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return curatorJsonError(error, 'Failed to notify students');
  }
}
