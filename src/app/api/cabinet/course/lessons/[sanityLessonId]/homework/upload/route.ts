import { NextResponse } from 'next/server';
import { getCabinetAuth } from '@/lib/cabinet-auth';
import { uploadStudentHomeworkFile } from '@/lib/cabinet-homework-upload';
import { gateCabinetLessonCourse } from '@/lib/cabinet/lesson-course-api';

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

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Выберите файл' }, { status: 400 });
  }

  try {
    const gate = await gateCabinetLessonCourse(
      auth.admin,
      auth.telegramId,
      sanityLessonId,
      request,
    );
    if (!gate.ok) return gate.response;
    const fileUrl = await uploadStudentHomeworkFile(auth.admin, auth.telegramId, sanityLessonId, file);
    return NextResponse.json({ fileUrl });
  } catch (error) {
    console.error('[homework/upload]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось загрузить файл' },
      { status: 500 },
    );
  }
}
