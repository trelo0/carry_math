import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCabinetAuth } from '@/lib/cabinet-auth';
import {
  CourseWatchDeniedError,
  reportLessonMaterialOpenedWithGate,
} from '@/lib/bot/education/course-watch-gate';
import { gateCabinetLessonCourse, readCourseSlugFromRequest } from '@/lib/cabinet/lesson-course-api';

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

  let materialKey = '';
  try {
    const body = (await request.json()) as { materialKey?: string };
    materialKey = body.materialKey?.trim() ?? '';
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!materialKey) {
    return NextResponse.json({ error: 'materialKey required' }, { status: 400 });
  }

  try {
    const gate = await gateCabinetLessonCourse(
      auth.admin,
      auth.telegramId,
      sanityLessonId,
      request,
    );
    if (!gate.ok) return gate.response;
    await reportLessonMaterialOpenedWithGate(
      auth.admin,
      auth.telegramId,
      sanityLessonId,
      materialKey,
      readCourseSlugFromRequest(request),
    );
    revalidatePath('/cabinet');
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
