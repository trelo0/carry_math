import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCabinetAuth } from '@/lib/cabinet-auth';
import { LessonBookingError, cancelLessonBooking, isLessonBookingTableError } from '@/lib/teacher/booking';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const auth = await getCabinetAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  try {
    await cancelLessonBooking(auth.admin, id, auth.telegramId);
    revalidatePath('/cabinet');
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isLessonBookingTableError(error)) {
      return NextResponse.json({ error: 'Запись временно недоступна' }, { status: 503 });
    }
    if (error instanceof LessonBookingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    }
    throw error;
  }
}
