import { NextResponse } from 'next/server';
import { getCabinetAuth } from '@/lib/cabinet-auth';
import { getAvailableCommitSlots } from '@/lib/bot/lesson-credits';
import { isLessonBookingTableError } from '@/lib/teacher/booking';
import { listAvailableBookingSlots } from '@/lib/teacher/booking-slots';

export async function GET(request: Request) {
  const auth = await getCabinetAuth();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const teacherTelegramId = Number(searchParams.get('teacherTelegramId'));
  const kind = searchParams.get('kind') as 'individual' | 'group' | null;
  const date = searchParams.get('date')?.trim();

  if (!teacherTelegramId || !kind || !date) {
    return NextResponse.json({ error: 'teacherTelegramId, kind, date required' }, { status: 400 });
  }
  if (kind !== 'individual' && kind !== 'group') {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  }

  try {
    const [slots, credits] = await Promise.all([
      listAvailableBookingSlots(auth.admin, teacherTelegramId, date),
      getAvailableCommitSlots(auth.admin, auth.telegramId, kind),
    ]);
    return NextResponse.json({ slots, credits });
  } catch (error) {
    if (isLessonBookingTableError(error)) {
      return NextResponse.json({ slots: [], credits: { available: 0, remaining: 0, scheduled: 0, packageId: null } });
    }
    const message = error instanceof Error ? error.message : 'Error';
    const code = (error as { code?: string }).code;
    if (code === 'NO_CREDIT' || message.includes('не осталось') || message.includes('Нет оплаченных')) {
      return NextResponse.json({
        slots: [],
        credits: { available: 0, remaining: 0, scheduled: 0, packageId: null },
        error: message,
      });
    }
    throw error;
  }
}
