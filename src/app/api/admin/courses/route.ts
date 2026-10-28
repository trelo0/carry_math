import { NextResponse } from 'next/server';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { createCourse, type CreateCourseInput } from '@/lib/admin/course-docs';
import { SettingsDocError } from '@/lib/admin/settings-docs';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** POST — создать курс в Sanity (опубликован, но закрыт) и строку в Supabase. */
export async function POST(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: CreateCourseInput;
  try {
    body = (await request.json()) as CreateCourseInput;
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }
  try {
    const result = await createCourse(createAdminClient(), body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof SettingsDocError) {
      return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
    }
    console.error('[admin courses create]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ошибка' }, { status: 500 });
  }
}
