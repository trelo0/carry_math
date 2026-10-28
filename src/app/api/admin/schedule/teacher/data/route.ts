import { NextResponse } from 'next/server';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { assertScheduleTeacherTarget, parseTeacherTelegramId } from '@/lib/admin/schedule-target';
import { getTeacherCabinetData } from '@/lib/teacher/cabinet-data';
import { curatorJsonError } from '@/lib/curator/api-errors';

export async function GET(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const teacherTelegramId = parseTeacherTelegramId(url);
  if (teacherTelegramId == null) {
    return NextResponse.json({ error: 'teacherTelegramId required' }, { status: 400 });
  }

  const target = await assertScheduleTeacherTarget(auth.admin, teacherTelegramId);
  if (!target.ok) {
    return NextResponse.json({ error: target.error }, { status: target.status });
  }

  try {
    const teacher = await getTeacherCabinetData(auth.admin, teacherTelegramId, target.fullName);
    return NextResponse.json(teacher);
  } catch (error) {
    return curatorJsonError(error, 'Failed to load teacher schedule');
  }
}
