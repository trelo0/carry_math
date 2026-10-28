import { NextResponse } from 'next/server';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { deleteCourseEntity, type DeleteEntity } from '@/lib/admin/course-docs';
import { SettingsDocError } from '@/lib/admin/settings-docs';
import { logAdminAction } from '@/lib/bot/admin/action-log';

export const dynamic = 'force-dynamic';

type Body = { entity?: string; id?: string; courseId?: number | null };

/** POST { entity: course|module|lesson, id, courseId? } — полное удаление документа из Sanity. */
export async function POST(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }
  if (!body.id || !['course', 'module', 'lesson'].includes(body.entity ?? '')) {
    return NextResponse.json({ error: 'Не указан документ' }, { status: 400 });
  }
  const entity = body.entity as DeleteEntity;
  try {
    const result = await deleteCourseEntity(entity, body.id);
    if (entity === 'course' && Number.isFinite(Number(body.courseId))) {
      // Курса в Sanity больше нет — строку в базе не удаляем (история), но деактивируем.
      await auth.admin
        .from('courses')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', Number(body.courseId));
    }
    await logAdminAction(auth.admin, {
      actorTelegramId: auth.telegramId,
      action: 'course.delete',
      entityType: 'course',
      entityId: body.id,
      detail: { entity, sanityId: body.id, deleted: result.deleted },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof SettingsDocError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[admin courses delete]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ошибка удаления' }, { status: 500 });
  }
}
