import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { reviewLessonHomework } from '@/lib/lesson-homework';

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

  const body = (await request.json()) as { action?: string; comment?: string };
  if (body.action !== 'approve' && body.action !== 'revision') {
    return NextResponse.json({ error: 'action must be approve or revision' }, { status: 400 });
  }

  try {
    const homework = await reviewLessonHomework(auth.admin, auth.telegramId, id, {
      action: body.action,
      comment: body.comment,
    });
    revalidatePath('/cabinet/staff');
    return NextResponse.json(homework);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Review failed' },
      { status: 400 },
    );
  }
}
