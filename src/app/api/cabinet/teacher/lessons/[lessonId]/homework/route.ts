import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { getLessonHomework, upsertTeacherLessonHomework } from '@/lib/lesson-homework';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = Number((await params).lessonId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid lesson id' }, { status: 400 });
  }

  try {
    const homework = await getLessonHomework(auth.admin, id);
    return NextResponse.json({ homework });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load homework' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = Number((await params).lessonId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid lesson id' }, { status: 400 });
  }

  const form = await request.formData();
  const file = form.get('file');
  const instructionText = String(form.get('instructionText') ?? '');
  const dueAtRaw = String(form.get('dueAt') ?? '').trim();

  try {
    const homework = await upsertTeacherLessonHomework(auth.admin, auth.telegramId, id, {
      file: file instanceof File && file.size > 0 ? file : undefined,
      instructionText,
      dueAt: dueAtRaw || null,
    });
    revalidatePath('/cabinet/staff');
    return NextResponse.json(homework);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 400 },
    );
  }
}
