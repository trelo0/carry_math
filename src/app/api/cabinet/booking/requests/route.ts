import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCabinetAuth } from '@/lib/cabinet-auth';
import {
  LessonBookingError,
  createLessonBooking,
  isLessonBookingTableError,
  listStudentBookings,
} from '@/lib/teacher/booking';

export async function GET() {
  const auth = await getCabinetAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const bookings = await listStudentBookings(auth.admin, auth.telegramId);
    return NextResponse.json({ bookings });
  } catch (error) {
    if (isLessonBookingTableError(error)) {
      return NextResponse.json({ bookings: [] });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const auth = await getCabinetAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as {
    teacherTelegramId?: number;
    kind?: 'individual' | 'group';
    startsAt?: string;
    durationMinutes?: number;
    groupId?: number;
  };

  if (!body.teacherTelegramId || !body.kind || !body.startsAt) {
    return NextResponse.json({ error: 'teacherTelegramId, kind, startsAt required' }, { status: 400 });
  }

  try {
    const booking = await createLessonBooking(auth.admin, auth.telegramId, {
      teacherTelegramId: body.teacherTelegramId,
      kind: body.kind,
      startsAt: body.startsAt,
      durationMinutes: body.durationMinutes,
      groupId: body.groupId,
    });
    revalidatePath('/cabinet');
    return NextResponse.json({ booking });
  } catch (error) {
    if (isLessonBookingTableError(error)) {
      return NextResponse.json({ error: 'Запись временно недоступна' }, { status: 503 });
    }
    if (error instanceof LessonBookingError) {
      const status = error.code === 'NO_CREDIT' ? 402 : error.code === 'SLOT_BUSY' ? 409 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }
}
