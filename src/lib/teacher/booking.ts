import type { SupabaseClient } from '@supabase/supabase-js';
import { LessonCreditError, assertLessonCreditAvailable } from '@/lib/bot/lesson-credits';
import { scheduleLesson } from '@/lib/bot/lessons';
import { notifyStudentLessonScheduled } from '@/lib/bot/student-notifications';
import { getStudentTeacher } from '@/lib/bot/education/assignments';
import { ScheduleValidationError, validateLessonSlot } from '@/lib/teacher/schedule-validation';
import type { LessonBookingStatus, LessonBookingView } from '@/lib/teacher/booking-types';

export class LessonBookingError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'UNAUTHORIZED'
      | 'NOT_FOUND'
      | 'INVALID'
      | 'NO_CREDIT'
      | 'SLOT_BUSY'
      | 'NOT_PENDING'
      | 'PACKAGE_MISMATCH',
  ) {
    super(message);
    this.name = 'LessonBookingError';
  }
}

const BOOKING_COLUMNS =
  'id, created_at, student_telegram_id, teacher_telegram_id, kind, group_id, package_id, starts_at, duration_minutes, status, scheduled_lesson_id';

type BookingRow = {
  id: string;
  created_at: string;
  student_telegram_id: number;
  teacher_telegram_id: number;
  kind: 'individual' | 'group';
  group_id: number | null;
  package_id: number | null;
  starts_at: string;
  duration_minutes: number;
  status: LessonBookingStatus;
  scheduled_lesson_id: number | null;
};

export function isLessonBookingTableError(error: unknown): boolean {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message = String(details?.message ?? error);
  const code = String(details?.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return message.includes('lesson_booking_requests') && (
    message.includes('does not exist') || message.includes('Could not find')
  );
}

async function mapBookingRow(admin: SupabaseClient, row: BookingRow): Promise<LessonBookingView> {
  const ids = [row.student_telegram_id];
  let groupTitle: string | null = null;
  if (row.group_id) {
    const { data: group } = await admin.from('groups').select('title').eq('id', row.group_id).maybeSingle();
    groupTitle = (group?.title as string | null) ?? null;
  }
  const { data: members } = await admin
    .from('bot_members')
    .select('telegram_id, full_name')
    .in('telegram_id', ids);
  const names = new Map((members ?? []).map((m) => [m.telegram_id as number, m.full_name as string | null]));

  return {
    id: row.id,
    studentTelegramId: row.student_telegram_id,
    studentName: names.get(row.student_telegram_id) ?? null,
    teacherTelegramId: row.teacher_telegram_id,
    kind: row.kind,
    groupId: row.group_id,
    groupTitle,
    packageId: row.package_id,
    startsAt: row.starts_at,
    durationMinutes: row.duration_minutes,
    status: row.status,
    scheduledLessonId: row.scheduled_lesson_id,
    createdAt: row.created_at,
  };
}

export async function listStudentBookings(
  admin: SupabaseClient,
  studentTelegramId: number,
): Promise<LessonBookingView[]> {
  const { data, error } = await admin
    .from('lesson_booking_requests')
    .select(BOOKING_COLUMNS)
    .eq('student_telegram_id', studentTelegramId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return Promise.all(((data ?? []) as BookingRow[]).map((row) => mapBookingRow(admin, row)));
}

export async function listTeacherBookings(
  admin: SupabaseClient,
  teacherTelegramId: number,
  status?: LessonBookingStatus,
): Promise<LessonBookingView[]> {
  let query = admin
    .from('lesson_booking_requests')
    .select(BOOKING_COLUMNS)
    .eq('teacher_telegram_id', teacherTelegramId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return Promise.all(((data ?? []) as BookingRow[]).map((row) => mapBookingRow(admin, row)));
}

export async function getBookingRequest(
  admin: SupabaseClient,
  id: string,
): Promise<LessonBookingView | null> {
  const { data, error } = await admin
    .from('lesson_booking_requests')
    .select(BOOKING_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapBookingRow(admin, data as BookingRow);
}

async function assertStudentGroupMembership(
  admin: SupabaseClient,
  studentTelegramId: number,
  groupId: number,
): Promise<void> {
  const { data } = await admin
    .from('group_members')
    .select('telegram_id')
    .eq('group_id', groupId)
    .eq('telegram_id', studentTelegramId)
    .eq('status', 'active')
    .maybeSingle();
  if (!data) {
    throw new LessonBookingError('Вы не состоите в этой группе.', 'INVALID');
  }
}

export async function createLessonBooking(
  admin: SupabaseClient,
  studentTelegramId: number,
  input: {
    teacherTelegramId: number;
    kind: 'individual' | 'group';
    startsAt: string;
    durationMinutes?: number;
    groupId?: number;
  },
): Promise<LessonBookingView> {
  const kind = input.kind;
  const durationMinutes = input.durationMinutes ?? 60;

  if (kind === 'group') {
    if (!input.groupId) {
      throw new LessonBookingError('Для групповой записи нужна группа.', 'INVALID');
    }
    await assertStudentGroupMembership(admin, studentTelegramId, input.groupId);
    const { data: group } = await admin
      .from('groups')
      .select('teacher_telegram_id')
      .eq('id', input.groupId)
      .maybeSingle();
    if (!group || (group.teacher_telegram_id as number) !== input.teacherTelegramId) {
      throw new LessonBookingError('Группа не принадлежит выбранному преподавателю.', 'INVALID');
    }
  } else {
    const teacher = await getStudentTeacher(admin, studentTelegramId);
    if (teacher && teacher.telegramId !== input.teacherTelegramId) {
      throw new LessonBookingError('Можно записаться только к своему преподавателю.', 'INVALID');
    }
  }

  let packageId: number;
  try {
    ({ packageId } = await assertLessonCreditAvailable(admin, studentTelegramId, kind));
  } catch (error) {
    if (error instanceof LessonCreditError) {
      throw new LessonBookingError(error.message, 'NO_CREDIT');
    }
    throw error;
  }

  try {
    await validateLessonSlot(admin, input.teacherTelegramId, { startsAt: input.startsAt, durationMinutes });
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      throw new LessonBookingError(error.message, 'SLOT_BUSY');
    }
    throw error;
  }

  const { data, error } = await admin
    .from('lesson_booking_requests')
    .insert({
      student_telegram_id: studentTelegramId,
      teacher_telegram_id: input.teacherTelegramId,
      kind,
      group_id: input.groupId ?? null,
      package_id: packageId,
      starts_at: input.startsAt,
      duration_minutes: durationMinutes,
      status: 'pending',
    })
    .select(BOOKING_COLUMNS)
    .single();

  if (error) {
    if (String(error.message).includes('lesson_booking_requests_teacher_slot_pending_idx')) {
      throw new LessonBookingError('Это время уже занято. Выберите другой слот.', 'SLOT_BUSY');
    }
    throw error;
  }

  return mapBookingRow(admin, data as BookingRow);
}

export async function cancelLessonBooking(
  admin: SupabaseClient,
  bookingId: string,
  studentTelegramId: number,
): Promise<void> {
  const { data, error } = await admin
    .from('lesson_booking_requests')
    .update({
      status: 'cancelled',
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .eq('student_telegram_id', studentTelegramId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new LessonBookingError('Заявка не найдена или уже обработана.', 'NOT_FOUND');
  }
}

export async function confirmLessonBooking(
  admin: SupabaseClient,
  bookingId: string,
  teacherTelegramId: number,
): Promise<{ booking: LessonBookingView; lessonId: number }> {
  const row = await admin
    .from('lesson_booking_requests')
    .select(BOOKING_COLUMNS)
    .eq('id', bookingId)
    .eq('teacher_telegram_id', teacherTelegramId)
    .maybeSingle();
  if (row.error) throw row.error;
  const booking = row.data as BookingRow | null;
  if (!booking) {
    throw new LessonBookingError('Заявка не найдена.', 'NOT_FOUND');
  }
  if (booking.status === 'confirmed' && booking.scheduled_lesson_id) {
    return { booking: await mapBookingRow(admin, booking), lessonId: booking.scheduled_lesson_id };
  }
  if (booking.status !== 'pending') {
    throw new LessonBookingError('Заявка уже обработана.', 'NOT_PENDING');
  }

  let packageId = booking.package_id ?? undefined;
  try {
    ({ packageId } = await assertLessonCreditAvailable(
      admin,
      booking.student_telegram_id,
      booking.kind,
      packageId,
    ));
  } catch (error) {
    if (error instanceof LessonCreditError) {
      throw new LessonBookingError(
        'Невозможно подтвердить запись. У ученика больше нет доступного занятия.',
        'NO_CREDIT',
      );
    }
    throw error;
  }

  try {
    await validateLessonSlot(admin, teacherTelegramId, {
      startsAt: booking.starts_at,
      durationMinutes: booking.duration_minutes,
    });
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      throw new LessonBookingError('Это время уже занято. Заявка не подтверждена.', 'SLOT_BUSY');
    }
    throw error;
  }

  const topic = booking.kind === 'group' ? 'Групповое занятие' : 'Индивидуальное занятие';
  const lessonId = await scheduleLesson(admin, {
    telegramId: booking.student_telegram_id,
    kind: booking.kind,
    startsAt: booking.starts_at,
    topic,
    packageId: packageId!,
    teacherTelegramId,
    groupId: booking.group_id ?? undefined,
    durationMinutes: booking.duration_minutes,
  });

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from('lesson_booking_requests')
    .update({
      status: 'confirmed',
      package_id: packageId,
      scheduled_lesson_id: lessonId,
      resolved_at: now,
      resolved_by: teacherTelegramId,
      updated_at: now,
    })
    .eq('id', bookingId)
    .eq('status', 'pending')
    .select(BOOKING_COLUMNS)
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) {
    await admin.from('scheduled_lessons').delete().eq('id', lessonId);
    const again = await admin
      .from('lesson_booking_requests')
      .select(BOOKING_COLUMNS)
      .eq('id', bookingId)
      .maybeSingle();
    if (again.data?.status === 'confirmed' && again.data.scheduled_lesson_id) {
      return {
        booking: await mapBookingRow(admin, again.data as BookingRow),
        lessonId: again.data.scheduled_lesson_id as number,
      };
    }
    throw new LessonBookingError('Не удалось подтвердить заявку. Попробуйте ещё раз.', 'NOT_PENDING');
  }

  await notifyStudentLessonScheduled(admin, booking.student_telegram_id, {
    kind: booking.kind,
    topic,
    startsAt: booking.starts_at,
  });

  return { booking: await mapBookingRow(admin, updated as BookingRow), lessonId };
}

export async function rejectLessonBooking(
  admin: SupabaseClient,
  bookingId: string,
  teacherTelegramId: number,
): Promise<LessonBookingView> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('lesson_booking_requests')
    .update({
      status: 'rejected',
      resolved_at: now,
      resolved_by: teacherTelegramId,
      updated_at: now,
    })
    .eq('id', bookingId)
    .eq('teacher_telegram_id', teacherTelegramId)
    .eq('status', 'pending')
    .select(BOOKING_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const existing = await getBookingRequest(admin, bookingId);
    if (existing && existing.teacherTelegramId === teacherTelegramId) {
      return existing;
    }
    throw new LessonBookingError('Заявка не найдена или уже обработана.', 'NOT_FOUND');
  }
  return mapBookingRow(admin, data as BookingRow);
}
