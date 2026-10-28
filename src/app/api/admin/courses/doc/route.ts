import { NextResponse } from 'next/server';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { COURSE_SCOPES, saveCourseDoc, type CourseScope } from '@/lib/admin/course-docs';
import { syncCourseRowFromSanity } from '@/lib/admin/courses-data';
import { SettingsDocError } from '@/lib/admin/settings-docs';

export const dynamic = 'force-dynamic';

/** PUT { scope, id?, parentId?, values, rev? } — сохранить и опубликовать поля курса/модуля/занятия. */
export async function PUT(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { scope?: string; id?: string | null; parentId?: string | null; values?: unknown; rev?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }
  if (!body.scope || !(body.scope in COURSE_SCOPES)) {
    return NextResponse.json({ error: 'Неизвестный раздел' }, { status: 400 });
  }
  try {
    const doc = await saveCourseDoc({
      scope: body.scope as CourseScope,
      id: body.id,
      parentId: body.parentId,
      values: body.values,
      rev: body.rev,
    });
    if (doc._type === 'districtCourse') {
      await syncCourseRowFromSanity(auth.admin, doc);
    }
    return NextResponse.json({ ok: true, doc });
  } catch (error) {
    if (error instanceof SettingsDocError) {
      return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
    }
    console.error('[admin courses doc]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ошибка' }, { status: 500 });
  }
}
