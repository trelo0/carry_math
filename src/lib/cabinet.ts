import { createAdminClient } from '@/lib/supabase/admin';

// Данные личного кабинета ученика.
//
// Схема проекта связывает ученика с учебными данными так:
//   auth-пользователь (телефон) → telegram_links → telegram_id →
//   → user_accesses / course_enrollments / groups / mentor_assignments.
//
// Все таблицы закрыты RLS (только service_role), поэтому чтение идёт
// через серверный admin-клиент. Никаких новых таблиц не создаём:
// разделы без данных (ДЗ, платежи, жизни) отображаются как «скоро».

export type CabinetMode = 'course' | 'individual';
export type CabinetAccessProduct = 'course' | 'individual' | 'group';

export type CabinetAccess = {
  product: CabinetAccessProduct;
  expiresAt: string | null; // null = бессрочный
};

export type CabinetEnrollment = {
  courseTitle: string;
  status: string;
  startedAt: string;
};

export type CabinetGroup = {
  title: string;
  teacherName: string | null;
};

export type CabinetMentor = {
  kind: 'teacher' | 'curator';
  name: string;
};

export type CabinetData = {
  phone: string;
  createdAt: string;
  studentName: string | null;
  telegramLinked: boolean;
  accesses: CabinetAccess[];
  enrollment: CabinetEnrollment | null;
  group: CabinetGroup | null;
  mentors: CabinetMentor[];
};

const ACTIVE = 'active';

function isNotExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() > Date.now();
}

export async function getCabinetData(phone: string, createdAt: string): Promise<CabinetData> {
  const empty: CabinetData = {
    phone,
    createdAt,
    studentName: null,
    telegramLinked: false,
    accesses: [],
    enrollment: null,
    group: null,
    mentors: [],
  };

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    // Supabase service role не настроен — не роняем кабинет.
    return empty;
  }

  // Привязка телефона к Telegram.
  const { data: link, error: linkError } = await admin
    .from('telegram_links')
    .select('telegram_id')
    .eq('phone', phone)
    .maybeSingle();
  if (linkError || !link?.telegram_id) return empty;
  const telegramId = link.telegram_id as number;

  // Имя ученика из профиля бота (если заполнено).
  const { data: member } = await admin
    .from('bot_members')
    .select('full_name')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  const studentName = member?.full_name ?? null;

  // Активные продуктовые доступы.
  const { data: accessRows, error: accessError } = await admin
    .from('user_accesses')
    .select('product, expires_at')
    .eq('telegram_id', telegramId)
    .eq('status', ACTIVE);
  const accesses: CabinetAccess[] = accessError
    ? []
    : (accessRows ?? [])
        .filter((row) => isNotExpired(row.expires_at ?? null))
        .map((row) => ({
          product: row.product as CabinetAccessProduct,
          expiresAt: row.expires_at ?? null,
        }));

  // Активное зачисление на курс.
  const { data: enrollmentRows, error: enrollmentError } = await admin
    .from('course_enrollments')
    .select('status, started_at, courses(title)')
    .eq('telegram_id', telegramId)
    .eq('status', ACTIVE)
    .order('started_at', { ascending: false })
    .limit(1);
  let enrollment: CabinetEnrollment | null = null;
  if (!enrollmentError && enrollmentRows?.[0]) {
    const row = enrollmentRows[0];
    const courseTitle = (row.courses as { title?: string } | null)?.title;
    if (courseTitle) {
      enrollment = {
        courseTitle,
        status: row.status,
        startedAt: row.started_at,
      };
    }
  }

  // Активная группа + преподаватель группы.
  const { data: memberRows, error: memberError } = await admin
    .from('group_members')
    .select('groups(title, teacher_telegram_id)')
    .eq('telegram_id', telegramId)
    .eq('status', ACTIVE)
    .order('joined_at', { ascending: false })
    .limit(1);
  let group: CabinetGroup | null = null;
  if (!memberError && memberRows?.[0]) {
    const g = memberRows[0].groups as
      | { title?: string; teacher_telegram_id?: number | null }
      | null;
    if (g?.title) {
      group = { title: g.title, teacherName: null };
      if (g.teacher_telegram_id) {
        const { data: teacher } = await admin
          .from('bot_members')
          .select('full_name')
          .eq('telegram_id', g.teacher_telegram_id)
          .maybeSingle();
        if (teacher?.full_name) group.teacherName = teacher.full_name;
      }
    }
  }

  // Активные наставники (преподаватель/куратор).
  const { data: mentorRows, error: mentorError } = await admin
    .from('mentor_assignments')
    .select('kind, mentor_telegram_id')
    .eq('telegram_id', telegramId)
    .eq('status', ACTIVE);
  const mentors: CabinetMentor[] = [];
  if (!mentorError && mentorRows?.length) {
    const mentorIds = mentorRows.map((row) => row.mentor_telegram_id);
    const { data: memberNames } = await admin
      .from('bot_members')
      .select('telegram_id, full_name')
      .in('telegram_id', mentorIds);
    const names = new Map<number, string>(
      (memberNames ?? [])
        .filter((m) => m.full_name)
        .map((m) => [m.telegram_id, m.full_name]),
    );
    for (const row of mentorRows) {
      const name = names.get(row.mentor_telegram_id);
      if (name) mentors.push({ kind: row.kind as CabinetMentor['kind'], name });
    }
  }

  return {
    phone,
    createdAt,
    studentName,
    telegramLinked: true,
    accesses,
    enrollment,
    group,
    mentors,
  };
}
