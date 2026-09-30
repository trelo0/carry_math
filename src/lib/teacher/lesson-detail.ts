import type { SupabaseClient } from '@supabase/supabase-js';
import { formatLessonDateTime } from '@/lib/teacher/format';
import {
  listTeacherLessonMaterials,
  type TeacherLessonMaterialView,
} from '@/lib/teacher/lesson-materials';
import { getLessonHomework, type LessonHomeworkRow } from '@/lib/lesson-homework';

export type TeacherLessonHomeworkView = LessonHomeworkRow;

export type { TeacherLessonMaterialView };

export type TeacherLessonMemberView = {
  telegramId: number;
  name: string | null;
  phone: string | null;
};

export type TeacherLessonDetailView = {
  id: number;
  kind: 'individual' | 'group';
  topic: string;
  startsAt: string;
  date: string;
  time: string;
  durationMinutes: number;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  meetUrl: string | null;
  boardUrl: string | null;
  lessonPlan: string | null;
  cancelReason: string | null;
  student: TeacherLessonMemberView | null;
  group: {
    id: number;
    title: string;
    members: TeacherLessonMemberView[];
  } | null;
  materials: TeacherLessonMaterialView[];
  homework: TeacherLessonHomeworkView | null;
};

type ScheduledDetailRow = {
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

async function loadMembers(
  admin: SupabaseClient,
  telegramIds: number[],
): Promise<Map<number, TeacherLessonMemberView>> {
  if (telegramIds.length === 0) return new Map();
  const { data } = await admin
    .from('bot_members')
    .select('telegram_id, full_name, phone')
    .in('telegram_id', telegramIds);
  return new Map(
    (data ?? []).map((row) => [
      row.telegram_id as number,
      {
        telegramId: row.telegram_id as number,
        name: (row.full_name as string | null) ?? null,
        phone: (row.phone as string | null) ?? null,
      },
    ]),
  );
}

export async function getTeacherLessonDetail(
  admin: SupabaseClient,
  teacherTelegramId: number,
  lessonId: number,
): Promise<TeacherLessonDetailView | null> {
  const { data: row, error } = await admin
    .from('scheduled_lessons')
    .select(
      'id, kind, starts_at, topic, status, telegram_id, group_id, meet_url, board_url, lesson_plan, cancel_reason, duration_minutes',
    )
    .eq('id', lessonId)
    .eq('teacher_telegram_id', teacherTelegramId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;

  const lesson = row as ScheduledDetailRow;
  const { date, time } = formatLessonDateTime(lesson.starts_at);
  const [materials, homework] = await Promise.all([
    listTeacherLessonMaterials(admin, lesson.id),
    getLessonHomework(admin, lesson.id),
  ]);

  if (lesson.kind === 'individual') {
    const members = await loadMembers(admin, [lesson.telegram_id]);
    const student = members.get(lesson.telegram_id) ?? {
      telegramId: lesson.telegram_id,
      name: null,
      phone: null,
    };
    return {
      id: lesson.id,
      kind: lesson.kind,
      topic: lesson.topic,
      startsAt: lesson.starts_at,
      date,
      time,
      durationMinutes: lesson.duration_minutes ?? 60,
      status: lesson.status as TeacherLessonDetailView['status'],
      meetUrl: lesson.meet_url,
      boardUrl: lesson.board_url,
      lessonPlan: lesson.lesson_plan,
      cancelReason: lesson.cancel_reason,
      student,
      group: null,
      materials,
      homework,
    };
  }

  if (!lesson.group_id) {
    return {
      id: lesson.id,
      kind: lesson.kind,
      topic: lesson.topic,
      startsAt: lesson.starts_at,
      date,
      time,
      durationMinutes: lesson.duration_minutes ?? 60,
      status: lesson.status as TeacherLessonDetailView['status'],
      meetUrl: lesson.meet_url,
      boardUrl: lesson.board_url,
      lessonPlan: lesson.lesson_plan,
      cancelReason: lesson.cancel_reason,
      student: null,
      group: null,
      materials,
      homework,
    };
  }

  const [{ data: groupRow }, { data: memberRows }] = await Promise.all([
    admin
      .from('groups')
      .select('id, title')
      .eq('id', lesson.group_id)
      .eq('teacher_telegram_id', teacherTelegramId)
      .maybeSingle(),
    admin
      .from('group_members')
      .select('telegram_id')
      .eq('group_id', lesson.group_id)
      .eq('status', 'active'),
  ]);

  const memberIds = (memberRows ?? []).map((m) => m.telegram_id as number);
  const memberProfiles = await loadMembers(admin, memberIds);
  const members = memberIds.map(
    (id) =>
      memberProfiles.get(id) ?? {
        telegramId: id,
        name: null,
        phone: null,
      },
  );

  return {
    id: lesson.id,
    kind: lesson.kind,
    topic: lesson.topic,
    startsAt: lesson.starts_at,
    date,
    time,
    durationMinutes: lesson.duration_minutes ?? 60,
    status: lesson.status as TeacherLessonDetailView['status'],
    meetUrl: lesson.meet_url,
    boardUrl: lesson.board_url,
    lessonPlan: lesson.lesson_plan,
    cancelReason: lesson.cancel_reason,
    student: null,
    group: groupRow
      ? {
          id: groupRow.id as number,
          title: groupRow.title as string,
          members: members.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ru')),
        }
      : null,
    materials,
    homework,
  };
}
