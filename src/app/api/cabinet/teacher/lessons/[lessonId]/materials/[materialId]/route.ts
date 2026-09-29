import { NextResponse } from 'next/server';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { resolveTeacherLessonMaterialUrl } from '@/lib/teacher/lesson-materials';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lessonId: string; materialId: string }> },
) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { lessonId, materialId } = await params;
  const lessonIdNum = Number(lessonId);
  const materialIdNum = Number(materialId);
  if (!Number.isFinite(lessonIdNum) || !Number.isFinite(materialIdNum)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  try {
    const url = await resolveTeacherLessonMaterialUrl(
      auth.admin,
      auth.telegramId,
      lessonIdNum,
      materialIdNum,
    );
    if (!url) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    return NextResponse.redirect(url);
  } catch (error) {
    console.error('[teacher/lessons/materials]', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
