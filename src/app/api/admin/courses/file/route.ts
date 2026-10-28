import { NextResponse } from 'next/server';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { uploadCourseFile } from '@/lib/admin/course-docs';
import { SettingsDocError } from '@/lib/admin/settings-docs';

export const dynamic = 'force-dynamic';

/** POST multipart (file) — загрузить файл занятия в Sanity, вернуть ref для поля file. */
export async function POST(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Нет файла' }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await uploadCourseFile(file)) });
  } catch (error) {
    if (error instanceof SettingsDocError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[admin courses file]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ошибка загрузки' }, { status: 500 });
  }
}
