import { NextResponse } from 'next/server';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { isLessonBookingTableError, listTeacherBookings } from '@/lib/teacher/booking';

export async function GET(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const status = new URL(request.url).searchParams.get('status') ?? undefined;

  try {
    const bookings = await listTeacherBookings(
      auth.admin,
      auth.telegramId,
      status === 'pending' || status === 'confirmed' || status === 'rejected' || status === 'cancelled'
        ? status
        : undefined,
    );
    return NextResponse.json({ bookings });
  } catch (error) {
    if (isLessonBookingTableError(error)) {
      return NextResponse.json({ bookings: [] });
    }
    throw error;
  }
}
