import type { SupabaseClient } from '@supabase/supabase-js';
import type { BotRole } from '@/lib/bot/roles';
import { hasFullStaffPreview, memberHasRole } from '@/lib/bot/roles';
import { getCuratorCabinetData, type CuratorCabinetData } from '@/lib/curator/cabinet-data';
import { formatLessonDateTime } from '@/lib/teacher/format';
import { dedupeGroupLessons, findCurrentLesson } from '@/lib/teacher/lesson-utils';
import type { StudentPackageCredits } from '@/lib/teacher/package-credits';
import { loadStudentPackageCredits } from '@/lib/teacher/package-credits';

export type TeacherLessonView = {
  id: number;
  kind: 'individual' | 'group';
  startsAt: string;
  date: string;
  time: string;
  topic: string;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  studentTelegramId: number | null;
  studentName: string | null;
  groupId: number | null;
  groupTitle: string | null;
  meetUrl: string | null;
  boardUrl: string | null;
  lessonPlan: string | null;
  cancelReason: string | null;
  durationMinutes: number;
  isUpcoming: boolean;
};

export type TeacherStudentView = {
  telegramId: number;
  name: string | null;
  phone: string | null;
  notes: string;
  individualCount: number;
  groupCount: number;
  nextLessonAt: string | null;
  lessons: TeacherLessonView[];
  packageCredits: StudentPackageCredits;
};

export type TeacherDaySlot = {
  id: number;
  slotDate: string;
  startTime: string;
  endTime: string;
  slotKind: 'extra' | 'blocked' | 'break';
  label: string | null;
};

export type TeacherGroupMemberView = {
  telegramId: number;
  name: string | null;
};

export type TeacherGroupView = {
  id: number;
  title: string;
  notes: string;
  members: TeacherGroupMemberView[];
  lessons: TeacherLessonView[];
  nextLessonAt: string | null;
};

export type TeacherCabinetData = {
  staffName: string | null;
  nextLesson: TeacherLessonView | null;
  currentLesson: TeacherLessonView | null;
  individualLessons: TeacherLessonView[];
  groupLessons: TeacherLessonView[];
  /** Все занятия включая отменённые — для календаря расписания. */
  allLessons: TeacherLessonView[];
  students: TeacherStudentView[];
  groups: TeacherGroupView[];
  daySlots: TeacherDaySlot[];
};

export type StaffCabinetData = {
  memberRoles: BotRole[];
  staffName: string | null;
  fullStaffPreview: boolean;
  curator: CuratorCabinetData | null;
  teacher: TeacherCabinetData | null;
};

type ScheduledRow = {
  id: number;
  kind: 'individual' | 'group';
  starts_at: string;
  topic: string;
  status: string;
  telegram_id: number | null;
  group_id: number | null;
  meet_url: string | null;
  board_url: string | null;
  lesson_plan: string | null;
  cancel_reason: string | null;
  duration_minutes: number;
};

async function loadStudentNames(
  admin: SupabaseClient,
  ids: number[],
): Promise<Map<number, { name: string | null; phone: string | null }>> {
  if (ids.length === 0) return new Map();
  const { data } = await admin
    .from('bot_members')
    .select('telegram_id, full_name, phone')
    .in('telegram_id', ids);
  return new Map(
    (data ?? []).map((row) => [
      row.telegram_id as number,
      {
        name: (row.full_name as string | null) ?? null,
        phone: (row.phone as string | null) ?? null,
      },
    ]),
  );
}

async function loadGroupTitles(admin: SupabaseClient, ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await admin
    .from('groups')
    .select('id, title')
    .in('id', ids);
  return new Map((data ?? []).map((row) => [row.id as number, row.title as string]));
}

function mapLessonRow(
  row: ScheduledRow,
  names: Map<number, { name: string | null; phone: string | null }>,
  groups: Map<number, string>,
  now: number,
): TeacherLessonView {
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
    studentName: row.telegram_id ? (names.get(row.telegram_id)?.name ?? null) : null,
    groupId: row.group_id,
    groupTitle: row.group_id ? (groups.get(row.group_id) ?? null) : null,
    meetUrl: row.meet_url,
    boardUrl: row.board_url ?? null,
    lessonPlan: row.lesson_plan ?? null,
    cancelReason: row.cancel_reason ?? null,
    durationMinutes: row.duration_minutes ?? 60,
    isUpcoming: row.status === 'scheduled' && startsMs > now,
  };
}

export async function getTeacherCabinetData(
  admin: SupabaseClient,
  teacherTelegramId: number,
  staffName: string | null,
): Promise<TeacherCabinetData> {
  const now = Date.now();
  const lessonSelect =
    'id, kind, starts_at, topic, status, telegram_id, group_id, meet_url, board_url, lesson_plan, cancel_reason, duration_minutes';

  const lessonResult = await admin
    .from('scheduled_lessons')
    .select(lessonSelect)
    .eq('teacher_telegram_id', teacherTelegramId)
    .order('starts_at', { ascending: true });

  const [
    { data: groupRows },
    { data: daySlotRows },
    { data: studentNoteRows },
    { data: groupNoteRows },
  ] = await Promise.all([
    admin
      .from('groups')
      .select('id, title, status')
      .eq('teacher_telegram_id', teacherTelegramId)
      .eq('status', 'active')
      .order('title'),
    admin
      .from('teacher_day_slots')
      .select('id, slot_date, start_time, end_time, slot_kind, label')
      .eq('teacher_telegram_id', teacherTelegramId)
      .order('slot_date')
      .order('start_time'),
    admin
      .from('teacher_student_notes')
      .select('student_telegram_id, notes')
      .eq('teacher_telegram_id', teacherTelegramId),
    admin
      .from('teacher_group_notes')
      .select('group_id, notes')
      .eq('teacher_telegram_id', teacherTelegramId),
  ]);

  if (lessonResult.error) throw lessonResult.error;
  const lessonRows = lessonResult.data;

  const rows = (lessonRows ?? []) as ScheduledRow[];
  const studentNotes = new Map(
    (studentNoteRows ?? []).map((row) => [
      row.student_telegram_id as number,
      (row.notes as string) ?? '',
    ]),
  );
  const groupNotes = new Map(
    (groupNoteRows ?? []).map((row) => [row.group_id as number, (row.notes as string) ?? '']),
  );

  const activeGroupIds = (groupRows ?? []).map((group) => group.id as number);
  const membersByGroup = new Map<number, Array<{ telegramId: number; name: string | null }>>();
  if (activeGroupIds.length > 0) {
    const { data: memberRows } = await admin
      .from('group_members')
      .select('group_id, telegram_id, bot_members(full_name)')
      .in('group_id', activeGroupIds)
      .eq('status', 'active');
    for (const row of memberRows ?? []) {
      const typed = row as unknown as {
        group_id: number;
        telegram_id: number;
        bot_members: { full_name: string | null } | null;
      };
      const list = membersByGroup.get(typed.group_id) ?? [];
      list.push({
        telegramId: typed.telegram_id,
        name: typed.bot_members?.full_name ?? null,
      });
      membersByGroup.set(typed.group_id, list);
    }
  }
  const groupMemberLists = activeGroupIds.map((groupId) => ({
    groupId,
    members: membersByGroup.get(groupId) ?? [],
  }));

  const memberIdsFromGroups = groupMemberLists.flatMap((g) => g.members.map((m) => m.telegramId));
  const studentIds = [
    ...new Set([
      ...rows.map((r) => r.telegram_id).filter((id): id is number => typeof id === 'number'),
      ...memberIdsFromGroups,
    ]),
  ];
  const groupIds = [
    ...new Set([
      ...rows.map((r) => r.group_id).filter((id): id is number => typeof id === 'number'),
      ...(groupRows ?? []).map((g) => g.id as number),
    ]),
  ];
  const [names, groups] = await Promise.all([
    loadStudentNames(admin, studentIds),
    loadGroupTitles(admin, groupIds),
  ]);

  const lessons = rows.map((row) => mapLessonRow(row, names, groups, now));
  const activeLessons = lessons.filter((l) => l.status !== 'cancelled');
  const individualLessons = activeLessons.filter((l) => l.kind === 'individual');
  const groupLessons = activeLessons.filter((l) => l.kind === 'group');
  const upcoming = activeLessons.filter((l) => l.isUpcoming);
  const nextLesson = upcoming.length > 0 ? upcoming[0] : null;
  const currentLesson = findCurrentLesson(activeLessons, now);

  const studentsMap = new Map<number, TeacherStudentView>();
  for (const lesson of activeLessons) {
    if (lesson.studentTelegramId == null) continue;
    const existing = studentsMap.get(lesson.studentTelegramId);
    const profile = names.get(lesson.studentTelegramId);
    if (!existing) {
      studentsMap.set(lesson.studentTelegramId, {
        telegramId: lesson.studentTelegramId,
        name: profile?.name ?? lesson.studentName,
        phone: profile?.phone ?? null,
        notes: studentNotes.get(lesson.studentTelegramId) ?? '',
        individualCount: lesson.kind === 'individual' ? 1 : 0,
        groupCount: lesson.kind === 'group' ? 1 : 0,
        nextLessonAt: lesson.isUpcoming ? lesson.startsAt : null,
        lessons: [lesson],
        packageCredits: { individual: null, group: null },
      });
      continue;
    }
    existing.lessons.push(lesson);
    if (lesson.kind === 'individual') existing.individualCount += 1;
    if (lesson.kind === 'group') existing.groupCount += 1;
    if (lesson.isUpcoming && (!existing.nextLessonAt || lesson.startsAt < existing.nextLessonAt)) {
      existing.nextLessonAt = lesson.startsAt;
    }
  }

  for (const { members } of groupMemberLists) {
    for (const member of members) {
      if (studentsMap.has(member.telegramId)) continue;
      const profile = names.get(member.telegramId);
      studentsMap.set(member.telegramId, {
        telegramId: member.telegramId,
        name: member.name ?? profile?.name ?? null,
        phone: profile?.phone ?? null,
        notes: studentNotes.get(member.telegramId) ?? '',
        individualCount: 0,
        groupCount: 0,
        nextLessonAt: null,
        lessons: [],
        packageCredits: { individual: null, group: null },
      });
    }
  }

  const packageCreditsMap = await loadStudentPackageCredits(admin, [...studentsMap.keys()]);
  for (const student of studentsMap.values()) {
    student.packageCredits =
      packageCreditsMap.get(student.telegramId) ?? { individual: null, group: null };
  }

  const students = [...studentsMap.values()].sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? '', 'ru'),
  );

  const groupsView: TeacherGroupView[] = (groupRows ?? []).map((group) => {
    const groupId = group.id as number;
    const members = groupMemberLists.find((g) => g.groupId === groupId)?.members ?? [];
    const rawLessons = groupLessons.filter((l) => l.groupId === groupId);
    const uniqueLessons = dedupeGroupLessons(rawLessons);
    const nextGroupLesson = uniqueLessons.find((l) => l.isUpcoming)?.startsAt ?? null;
    return {
      id: groupId,
      title: group.title as string,
      notes: groupNotes.get(groupId) ?? '',
      members,
      lessons: uniqueLessons,
      nextLessonAt: nextGroupLesson,
    };
  });

  const daySlots: TeacherDaySlot[] = (daySlotRows ?? []).map((row) => ({
    id: row.id as number,
    slotDate: String(row.slot_date),
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    slotKind: (row.slot_kind as 'extra' | 'blocked' | 'break' | null) ?? 'extra',
    label: (row.label as string | null) ?? null,
  }));

  return {
    staffName,
    nextLesson,
    currentLesson,
    individualLessons,
    groupLessons,
    allLessons: lessons,
    students,
    groups: groupsView,
    daySlots,
  };
}

export async function getStaffCabinetData(
  admin: SupabaseClient,
  telegramId: number,
  roles: BotRole[],
  staffName: string | null,
): Promise<StaffCabinetData> {
  const fullStaffPreview = hasFullStaffPreview(roles, telegramId);
  const loadCurator = fullStaffPreview || memberHasRole(roles, 'curator');
  const loadTeacher = fullStaffPreview || memberHasRole(roles, 'teacher');

  const [curator, teacher] = await Promise.all([
    loadCurator ? getCuratorCabinetData(admin, telegramId, staffName) : Promise.resolve(null),
    loadTeacher ? getTeacherCabinetData(admin, telegramId, staffName) : Promise.resolve(null),
  ]);

  return {
    memberRoles: roles,
    staffName,
    fullStaffPreview,
    curator,
    teacher,
  };
}
