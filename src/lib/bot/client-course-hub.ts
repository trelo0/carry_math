import type { SupabaseClient } from '@supabase/supabase-js';
import { createCabinetLoginUrl } from '@/lib/cabinet-login';
import {
  flattenCourseLessons,
  getDistrictCourseContent,
} from '@/lib/studio/courseContent';
import { resolveCourseIdForContent } from '@/lib/bot/education/course-record';
import { getEnrollmentLives, isLivesTableError } from '@/lib/bot/education/lives';
import { resolveSubmitTargetLesson } from '@/lib/bot/education/course-homework';
import { deadlineUiState } from '@/lib/bot/education/homework-deadline';
import {
  loadSanityLessonSessionMap,
  resolveWebinarSessionStatus,
} from '@/lib/curator/lesson-session';
import {
  clientHomeButton,
  deliverClientHubScreen,
  type ClientHubDeliverOptions,
} from './client-nav';
import { formatDateTimeShort, formatRemainingMs } from './client-format';
import { getClientProductMode, resolveClientState } from './client-state';

function courseHwStatusLine(
  phase: ReturnType<typeof deadlineUiState>,
  remainingMs: number | null,
): string {
  switch (phase) {
    case 'waiting_review':
      return '⏳ ДЗ на проверке — ждите ответа куратора';
    case 'revision':
      return `✏️ Нужна доработка${remainingMs != null ? ` · осталось ${formatRemainingMs(remainingMs)}` : ''}`;
    case 'approved':
      return '✅ ДЗ принято — можно переходить дальше';
    case 'overdue':
      return '⏱ Срок сдачи ДЗ истёк';
    case 'soon':
    case 'ok':
      return `📝 Нужно сдать ДЗ · осталось ${formatRemainingMs(remainingMs)}`;
    default:
      return 'ДЗ по текущему занятию не ожидается';
  }
}

export async function showClientMyCourseHub(
  admin: SupabaseClient,
  telegramId: number,
  chatId: number,
  deliver?: ClientHubDeliverOptions,
): Promise<void> {
  const state = await resolveClientState(admin, telegramId);
  if (!state.hasActiveCourse) {
    await deliverClientHubScreen(
      admin,
      telegramId,
      chatId,
      'my-course-denied',
      '🎓 Мой курс\n\nРаздел доступен после подключения онлайн-курса.',
      { inline_keyboard: [[clientHomeButton()]] },
      deliver,
    );
    return;
  }

  const content = await getDistrictCourseContent().catch(() => null);
  const courseId = content ? await resolveCourseIdForContent(admin, content).catch(() => null) : null;
  const lessons = content
    ? flattenCourseLessons(content).filter((l) => l.publicationStatus === 'published')
    : [];

  let livesCurrent: number | null = null;
  let livesMax: number | null = null;
  if (courseId) {
    try {
      const lives = await getEnrollmentLives(admin, telegramId, courseId);
      livesCurrent = lives?.lives_current ?? null;
      livesMax = lives?.lives_max ?? null;
    } catch (error) {
      if (!isLivesTableError(error)) throw error;
    }
  }

  const { data: progressRows } = await admin
    .from('course_lesson_student_progress')
    .select('sanity_lesson_id, completed_at, homework_status, homework_remaining_ms, homework_deadline_at, homework_overdue_at')
    .eq('telegram_id', telegramId);

  const completed = (progressRows ?? []).filter((r) => r.completed_at).length;
  const total = lessons.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const now = Date.now();
  const sanityIds = lessons.map((l) => l.sanityId);
  const sessionMap = sanityIds.length > 0 ? await loadSanityLessonSessionMap(admin, sanityIds) : new Map();
  const { data: accessRows } = sanityIds.length
    ? await admin
        .from('course_lesson_access')
        .select('sanity_lesson_id, access_status')
        .eq('telegram_id', telegramId)
        .in('sanity_lesson_id', sanityIds)
    : { data: [] as Array<{ sanity_lesson_id: string; access_status: string }> };
  const accessMap = new Map(
    (accessRows ?? []).map((r) => [r.sanity_lesson_id as string, r.access_status as string]),
  );

  const upcoming = lessons
    .filter((l) => {
      const at = l.scheduledAt ? Date.parse(l.scheduledAt) : NaN;
      if (!Number.isFinite(at) || at < now) return false;
      const status = resolveWebinarSessionStatus(l.scheduledAt, sessionMap.get(l.sanityId));
      return status !== 'completed' && status !== 'cancelled';
    })
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
  const nextWebinar = upcoming[0] ?? null;
  const nextAccess = nextWebinar ? accessMap.get(nextWebinar.sanityId) : null;
  const nextAccessLabel =
    !nextWebinar
      ? null
      : nextAccess === 'available'
        ? 'доступ открыт'
        : nextAccess === 'blocked_lives'
          ? 'доступ ограничен (жизни)'
          : 'доступ пока закрыт (нужно одобренное ДЗ предыдущего занятия)';

  const target = await resolveSubmitTargetLesson(admin, telegramId);
  let hwLine = '📝 Текущее ДЗ: не ожидается';
  if (target) {
    const progress = target.progress;
    const phase = deadlineUiState(progress);
    const remaining =
      typeof progress?.homework_remaining_ms === 'number'
        ? progress.homework_remaining_ms
        : progress?.homework_deadline_at
          ? Math.max(0, Date.parse(progress.homework_deadline_at) - now)
          : null;
    hwLine = `📝 ДЗ №${target.lesson.lessonNumber} «${target.lesson.title}»\n${courseHwStatusLine(phase, remaining)}`;
  } else {
    const latestSubmitted = (progressRows ?? [])
      .filter((r) => r.homework_status === 'submitted' || r.homework_status === 'approved')
      .sort((a, b) => String(b.sanity_lesson_id).localeCompare(String(a.sanity_lesson_id)))[0];
    if (latestSubmitted?.homework_status === 'submitted') {
      hwLine = '⏳ Последнее отправленное ДЗ ожидает проверки';
    } else if (latestSubmitted?.homework_status === 'approved') {
      hwLine = '✅ Последнее ДЗ принято — можно смотреть следующий урок';
    }
  }

  const livesLabel =
    livesCurrent == null ? '—' : `${livesCurrent}${livesMax != null ? `/${livesMax}` : ''}`;

  const lines = [
    '🎓 Мой курс',
    content?.title ? `📚 ${content.title}` : null,
    '',
    `📊 Прогресс: ${completed}/${total} (${percent}%)`,
    `❤️ Жизни: ${livesLabel}`,
    '',
    nextWebinar
      ? `⏭ Ближайший вебинар: №${nextWebinar.lessonNumber} «${nextWebinar.title}»\n   ${formatDateTimeShort(nextWebinar.scheduledAt)}\n   ${nextAccessLabel}`
      : '⏭ Ближайший вебинар: не запланирован',
    '',
    hwLine,
  ].filter((x): x is string => x != null);

  const cabinetUrl = await createCabinetLoginUrl(admin, telegramId, '/cabinet?section=course').catch(
    () => null,
  );

  const rows: Array<Array<Record<string, string>>> = [
    [{ text: '📝 Домашние задания курса', callback_data: 'cl:chw:hub' }],
  ];
  if (cabinetUrl) {
    rows.push([{ text: '🌐 Открыть кабинет курса', url: cabinetUrl }]);
  }
  if (getClientProductMode(state) !== 'both') {
    rows.push([{ text: '💬 Связаться с куратором', callback_data: 'cl:course:ask' }]);
  }
  rows.push([clientHomeButton()]);

  await deliverClientHubScreen(
    admin,
    telegramId,
    chatId,
    'my-course',
    lines.join('\n'),
    { inline_keyboard: rows },
    deliver,
  );
}
