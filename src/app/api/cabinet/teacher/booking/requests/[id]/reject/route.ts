import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { LessonBookingError, isLessonBookingTableError, rejectLessonBooking } from '@/lib/teacher/booking';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const booking = await rejectLessonBooking(auth.admin, id, auth.telegramId);
    revalidatePath('/cabinet/staff');
    revalidatePath('/cabinet');
    return NextResponse.json({ booking });
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
