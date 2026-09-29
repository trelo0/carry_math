import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import {
  deleteTeacherLessonMaterial,
  uploadTeacherLessonMaterial,
} from '@/lib/teacher/lesson-materials';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { lessonId } = await params;
  const id = Number(lessonId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid lesson id' }, { status: 400 });
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'File required' }, { status: 400 });
  }

  try {
    const material = await uploadTeacherLessonMaterial(auth.admin, auth.telegramId, id, file);
    revalidatePath('/cabinet/staff');
    return NextResponse.json(material);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { lessonId } = await params;
  const id = Number(lessonId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid lesson id' }, { status: 400 });
  }

  const materialId = Number(new URL(request.url).searchParams.get('materialId'));
  if (!Number.isFinite(materialId)) {
    return NextResponse.json({ error: 'materialId required' }, { status: 400 });
  }

  try {
    await deleteTeacherLessonMaterial(auth.admin, auth.telegramId, id, materialId);
    revalidatePath('/cabinet/staff');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Delete failed' },
      { status: 400 },
    );
  }
}
