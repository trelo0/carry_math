import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { createRescheduleProposal } from '@/lib/teacher/reschedule';

export async function POST(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    lessonId?: number;
    options?: { startsAt: string }[];
  };
  if (!body.lessonId || !body.options?.length) {
    return NextResponse.json({ error: 'lessonId and options required' }, { status: 400 });
  }

  try {
    const proposalId = await createRescheduleProposal(auth.admin, {
      lessonId: body.lessonId,
      teacherTelegramId: auth.telegramId,
      options: body.options.slice(0, 3),
    });
    revalidatePath('/cabinet/staff');
    return NextResponse.json({ proposalId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Reschedule failed' },
      { status: 400 },
    );
  }
}
