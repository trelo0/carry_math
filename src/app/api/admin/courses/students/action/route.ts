import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireAdminApiAuth } from '@/lib/admin/api-auth';
import { COURSE_STUDENTS_TAG } from '@/lib/admin/course-students';
import { adjustLives, initEnrollmentLives } from '@/lib/bot/education/lives';
import { botPrivateTopicUrl, openStaffStudentDmTopic, staffDmTopicsEnabled } from '@/lib/bot/staff/dm-topics';

export const dynamic = 'force-dynamic';

type Body = {
  courseId?: number;
  telegramId?: number;
  action?: 'life_add' | 'life_remove' | 'contact';
  reason?: string;
};

/** POST — действия админа над учеником курса: ±жизнь, открыть тему в боте. */
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
  const telegramId = Number(body.telegramId);
  if (!Number.isFinite(courseId) || !Number.isFinite(telegramId)) {
    return NextResponse.json({ error: 'Не указан курс или ученик' }, { status: 400 });
  }

  try {
    if (body.action === 'contact') {
      if (!staffDmTopicsEnabled()) {
        return NextResponse.json({ error: 'Topics в боте отключены (STAFF_DM_TOPICS_ENABLED).' }, { status: 409 });
      }
      const res = await openStaffStudentDmTopic(auth.admin, {
        staffTelegramId: auth.telegramId,
        studentTelegramId: telegramId,
        staffRole: 'admin',
        courseIdHint: courseId,
      });
      if (!res.ok) return NextResponse.json({ error: res.error ?? 'Не удалось открыть тему' }, { status: 502 });
      return NextResponse.json({
        ok: true,
        url: res.messageThreadId ? botPrivateTopicUrl(res.messageThreadId) : null,
      });
    }

    if (body.action === 'life_add' || body.action === 'life_remove') {
      const add = body.action === 'life_add';
      // Нет записи о жизнях — создаём (по умолчанию полные).
      await initEnrollmentLives(auth.admin, telegramId, courseId);
      const { state, changed } = await adjustLives(auth.admin, {
        telegramId,
        courseId,
        delta: add ? 1 : -1,
        reason: body.reason?.trim() || (add ? 'Добавлено админом' : 'Снято админом'),
        actorTelegramId: auth.telegramId,
        operationType: add ? 'grant' : 'correction',
      });
      revalidateTag(COURSE_STUDENTS_TAG, { expire: 0 });
      return NextResponse.json({
        ok: true,
        changed,
        livesCurrent: state.lives_current,
        livesMax: state.lives_max,
        accessBlocked: state.access_blocked,
      });
    }

    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 });
  } catch (error) {
    console.error('[admin course student action]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ошибка' }, { status: 500 });
  }
}
