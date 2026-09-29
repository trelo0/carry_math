import { NextResponse } from 'next/server';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { getTeacherGroupDetail } from '@/lib/teacher/group-detail';

export async function GET(
  _request: Request,
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

  try {
    const detail = await getTeacherGroupDetail(auth.admin, auth.telegramId, id);
    if (!detail) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load group' },
      { status: 500 },
    );
  }
}
