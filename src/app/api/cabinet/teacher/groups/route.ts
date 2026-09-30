import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { createGroup } from '@/lib/bot/education/groups';

export async function POST(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as { title?: string };
  const title = body.title?.trim();
  if (!title) {
    return NextResponse.json({ error: 'Укажите название группы' }, { status: 400 });
  }

  try {
    const group = await createGroup(auth.admin, {
      title,
      teacherTelegramId: auth.telegramId,
    });
    revalidatePath('/cabinet/staff');
    return NextResponse.json({ id: group.id, title: group.title });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось создать группу' },
      { status: 400 },
    );
  }
}
