import type { SupabaseClient } from '@supabase/supabase-js';
import { formatLessonDateTime } from '@/lib/teacher/format';
import type { TeacherGroupMemberView, TeacherGroupView, TeacherLessonView } from '@/lib/teacher/cabinet-data';

type ScheduledRow = {
  id: number;
  kind: 'individual' | 'group';
  starts_at: string;
  topic: string;
  status: string;
  telegram_id: number;
  group_id: number | null;
  meet_url: string | null;
  board_url: string | null;
  lesson_plan: string | null;
  cancel_reason: string | null;
  duration_minutes: number;
};

function dedupeGroupLessons(lessons: TeacherLessonView[]): TeacherLessonView[] {
  const seen = new Set<string>();
  const result: TeacherLessonView[] = [];
  for (const lesson of lessons) {
    const key = `${lesson.groupId ?? 'none'}:${lesson.startsAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(lesson);
  }
  return result;
}

function mapLessonRow(row: ScheduledRow, now: number): TeacherLessonView {
  const { date, time } = formatLessonDateTime(row.starts_at);
  const startsMs = new Date(row.starts_at).getTime();
  return {
    id: row.id,
    kind: row.kind,
    startsAt: row.starts_at,
    date,
    time,
    topic: row.topic,
    status: row.status as TeacherLessonView['status'],
    studentTelegramId: row.telegram_id,
    studentName: null,
    groupId: row.group_id,
    groupTitle: null,
    meetUrl: row.meet_url,
    boardUrl: row.board_url,
    lessonPlan: row.lesson_plan,
    cancelReason: row.cancel_reason,
    durationMinutes: row.duration_minutes ?? 60,
    isUpcoming: row.status === 'scheduled' && startsMs > now,
  };
}

export type TeacherGroupDetailView = TeacherGroupView & {
  nextLesson: TeacherLessonView | null;
  recentLessons: TeacherLessonView[];
};

export async function getTeacherGroupDetail(
  admin: SupabaseClient,
  teacherTelegramId: number,
  groupId: number,
): Promise<TeacherGroupDetailView | null> {
  const { data: groupRow, error: groupError } = await admin
    .from('groups')
    .select('id, title, status')
    .eq('id', groupId)
    .eq('teacher_telegram_id', teacherTelegramId)
    .eq('status', 'active')
    .maybeSingle();
  if (groupError) throw groupError;
  if (!groupRow) return null;

  const [{ data: memberRows }, { data: noteRow }, { data: lessonRows }] = await Promise.all([
    admin
      .from('group_members')
      .select('telegram_id, bot_members(full_name)')
      .eq('group_id', groupId)
      .eq('status', 'active'),
    admin
      .from('teacher_group_notes')
      .select('notes')
      .eq('teacher_telegram_id', teacherTelegramId)
      .eq('group_id', groupId)
      .maybeSingle(),
    admin
      .from('scheduled_lessons')
      .select(
        'id, kind, starts_at, topic, status, telegram_id, group_id, meet_url, board_url, lesson_plan, cancel_reason, duration_minutes',
      )
      .eq('teacher_telegram_id', teacherTelegramId)
      .eq('group_id', groupId)
      .eq('kind', 'group')
      .order('starts_at', { ascending: false }),
  ]);

  const members: TeacherGroupMemberView[] = (memberRows ?? [])
    .map((row) => {
      const { bot_members, ...member } = row as unknown as {
        telegram_id: number;
        bot_members: { full_name: string | null } | null;
      };
      return {
        telegramId: member.telegram_id,
        name: bot_members?.full_name ?? null,
      };
    })
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ru'));

  const now = Date.now();
  const lessons = dedupeGroupLessons(
    (lessonRows ?? []).map((row) => mapLessonRow(row as ScheduledRow, now)),
  );
  const nextLesson =
    lessons
      .filter((lesson) => lesson.isUpcoming)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;
  const recentLessons = lessons
    .filter((lesson) => !lesson.isUpcoming)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, 5);

  return {
    id: groupRow.id as number,
    title: groupRow.title as string,
    notes: (noteRow?.notes as string | undefined) ?? '',
    members,
    lessons,
    nextLessonAt: nextLesson?.startsAt ?? null,
    nextLesson,
    recentLessons,
  };
}
