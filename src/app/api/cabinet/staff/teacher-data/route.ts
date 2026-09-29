import { NextResponse } from 'next/server';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { getTeacherCabinetData } from '@/lib/teacher/cabinet-data';
import { curatorJsonError } from '@/lib/curator/api-errors';

/** Лёгкое обновление только данных преподавателя (без Sanity / куратора). */
export async function GET() {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const teacher = await getTeacherCabinetData(auth.admin, auth.telegramId, auth.fullName);
    return NextResponse.json(teacher);
  } catch (error) {
    return curatorJsonError(error, 'Failed to load teacher data');
  }
}
