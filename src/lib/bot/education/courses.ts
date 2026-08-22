import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Курсы и зачисления (courses, course_enrollments)
//
// user_accesses.product = 'course' означает лишь право на формат;
// зачисление на конкретный курс живёт здесь. История не удаляется:
// отчисление — статус cancelled с ended_at.
// ---------------------------------------------------------------------------

export type EducationStatus = 'active' | 'completed' | 'cancelled';

export type Course = {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CourseEnrollment = {
  id: number;
  telegram_id: number;
  course_id: number;
  status: EducationStatus;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

// Зачисление «Мой курс»: активная запись вместе с данными курса.
export type StudentCourse = CourseEnrollment & {
  course: Pick<Course, 'title' | 'slug'>;
};

const COURSE_COLUMNS = 'id, title, slug, description, is_active, created_at, updated_at';

export async function getCourse(admin: SupabaseClient, courseId: number): Promise<Course | null> {
  const { data, error } = await admin
    .from('courses')
    .select(COURSE_COLUMNS)
    .eq('id', courseId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as Course) : null;
}

export async function getActiveCourses(admin: SupabaseClient): Promise<Course[]> {
  const { data, error } = await admin
    .from('courses')
    .select(COURSE_COLUMNS)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Course[];
}

export async function createCourse(
  admin: SupabaseClient,
  input: { title: string; slug: string; description?: string },
): Promise<Course> {
  const { data, error } = await admin
    .from('courses')
    .insert({ title: input.title, slug: input.slug, description: input.description ?? null })
    .select(COURSE_COLUMNS)
    .single();
  if (error) throw error;
  return data as Course;
}

export async function updateCourse(
  admin: SupabaseClient,
  courseId: number,
  patch: Partial<Pick<Course, 'title' | 'slug' | 'description' | 'is_active'>>,
): Promise<Course> {
  const { data, error } = await admin
    .from('courses')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', courseId)
    .select(COURSE_COLUMNS)
    .single();
  if (error) throw error;
  return data as Course;
}

// Активные зачисления ученика с названием курса — источник для «Мой курс».
export async function getStudentCourses(
  admin: SupabaseClient,
  telegramId: number,
): Promise<StudentCourse[]> {
  const { data, error } = await admin
    .from('course_enrollments')
    .select('id, telegram_id, course_id, status, started_at, ended_at, created_at, updated_at, courses(title, slug)')
    .eq('telegram_id', telegramId)
    .eq('status', 'active')
    .order('started_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => {
    // Вложенный ресурс приходит объектом; PostgREST-типы supabase-js
    // считают его массивом, поэтому приведение через unknown.
    const { courses, ...enrollment } = row as unknown as CourseEnrollment & {
      courses: Pick<Course, 'title' | 'slug'> | null;
    };
    return { ...enrollment, course: courses ?? { title: '', slug: '' } };
  });
}

// Зачисление: новая запись или повторное зачисление после cancelled/completed
// (unique-индекс telegram_id + course_id).
export async function enrollStudent(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
  options: { startedAt?: string } = {},
): Promise<CourseEnrollment> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('course_enrollments')
    .upsert(
      {
        telegram_id: telegramId,
        course_id: courseId,
        status: 'active',
        started_at: options.startedAt ?? now,
        ended_at: null,
        updated_at: now,
      },
      { onConflict: 'telegram_id,course_id' },
    )
    .select('id, telegram_id, course_id, status, started_at, ended_at, created_at, updated_at')
    .single();
  if (error) throw error;
  return data as CourseEnrollment;
}

// Отчисление: запись сохраняется как cancelled (история не теряется).
// Возвращает false, если активного зачисления нет.
export async function removeStudentFromCourse(
  admin: SupabaseClient,
  telegramId: number,
  courseId: number,
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('course_enrollments')
    .update({ status: 'cancelled', ended_at: now, updated_at: now })
    .eq('telegram_id', telegramId)
    .eq('course_id', courseId)
    .eq('status', 'active')
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}
