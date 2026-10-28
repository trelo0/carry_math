import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { COURSE_STUDENTS_TAG } from '@/lib/admin/course-students';
import { logAdminAction } from '@/lib/bot/admin/action-log';
import { adjustLives } from '@/lib/bot/education/lives';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Body = { courseId?: number };

/** POST — восстановить жизни до максимума всем ученикам курса. */
export async function POST(request: Request) {
  const auth = await requireAdminApiAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }
  const courseId = Number(body.courseId);
  if (!Number.isFinite(courseId)) return NextResponse.json({ error: 'Не указан курс' }, { status: 400 });

  try {
    const { data: enrolled, error: enrError } = await auth.admin
      .from('course_enrollments')
      .select('telegram_id')
      .eq('course_id', courseId)
      .eq('status', 'active');
    if (enrError) throw enrError;
    const ids = new Set((enrolled ?? []).map((r) => r.telegram_id as number));

    const { data: states, error } = await auth.admin
      .from('course_enrollment_state')
      .select('telegram_id, lives_current, lives_max, fully_blocked')
      .eq('course_id', courseId);
    if (error) throw error;

    const todo = (states ?? []).filter(
      (s) =>
        ids.has(s.telegram_id as number) &&
        (s.lives_current as number) < (s.lives_max as number) &&
        s.fully_blocked !== true,
    );

    let restored = 0;
    let failed = 0;
    for (let i = 0; i < todo.length; i += 8) {
      await Promise.all(
        todo.slice(i, i + 8).map(async (s) => {
          try {
            let left = (s.lives_max as number) - (s.lives_current as number);
            while (left > 0) {
              const step = Math.min(3, left); // в БД ограничение delta ∈ [-3; 3]
              await adjustLives(auth.admin, {
                telegramId: s.telegram_id as number,
                courseId,
                delta: step,
                reason: 'Восстановление жизней админом',
                actorTelegramId: auth.telegramId,
                operationType: 'grant',
              });
              left -= step;
            }
            restored += 1;
          } catch (e) {
            failed += 1;
            console.error('[admin restore lives]', s.telegram_id, e);
          }
        }),
      );
    }

    await logAdminAction(auth.admin, {
      actorTelegramId: auth.telegramId,
      action: 'course.lives_restore_all',
      entityType: 'course',
      entityId: courseId,
      detail: { restored, failed, total: ids.size },
    });
    revalidateTag(COURSE_STUDENTS_TAG, { expire: 0 });
    return NextResponse.json({ ok: true, restored, failed, total: ids.size });
  } catch (error) {
    console.error('[admin course restore lives]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось восстановить жизни' }, { status: 500 });
  }
}
