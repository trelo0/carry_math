import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { groupId } = await params;
  const id = Number(groupId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid group id' }, { status: 400 });
  }

  const { data: group } = await auth.admin
    .from('groups')
    .select('id')
    .eq('id', id)
    .eq('teacher_telegram_id', auth.telegramId)
    .maybeSingle();
  if (!group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  const body = (await request.json()) as { notes?: string };
  const notes = body.notes?.trim() ?? '';

  const { error } = await auth.admin.from('teacher_group_notes').upsert(
    {
      teacher_telegram_id: auth.telegramId,
      group_id: id,
      notes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'teacher_telegram_id,group_id' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  revalidatePath('/cabinet/staff');
  return NextResponse.json({ ok: true });
}
