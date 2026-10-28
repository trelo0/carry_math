import { NextResponse } from 'next/server';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { saveCourseStaff } from '@/lib/admin/course-staff-admin';
import { SettingsDocError } from '@/lib/admin/settings-docs';

export const dynamic = 'force-dynamic';

type Body = {
  courseId?: number;
  sanityId?: string;
  rev?: string | null;
  teacherId?: string | null;
  curatorTelegramId?: number | null;
  checkTelegramId?: number | null;
};

/** PUT — назначить/снять преподавателя (Sanity), куратора и проверяющего (Telegram ID). */
export async function PUT(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }
  const courseId = Number(body.courseId);
  if (!Number.isFinite(courseId) || !body.sanityId) {
    return NextResponse.json({ error: 'Не указан курс' }, { status: 400 });
  }
  try {
    const result = await saveCourseStaff(auth.admin, {
      courseId,
      sanityId: body.sanityId,
      rev: body.rev,
      teacherId: body.teacherId,
      curatorTelegramId: body.curatorTelegramId,
      checkTelegramId: body.checkTelegramId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof SettingsDocError) {
      return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
    }
    console.error('[admin course staff]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ошибка' }, { status: 500 });
  }
}
