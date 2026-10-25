import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { ScheduleValidationError } from '@/lib/teacher/schedule-validation';
import { applyWeekWithMoves } from '@/lib/teacher/apply-week-with-moves';
import type { DayMoveInput } from '@/lib/teacher/apply-day-with-moves';
import type { WeeklySlotInput } from '@/lib/teacher/working-hours';
import { timeToMinutes } from '@/lib/teacher/schedule-utils';

function validateWeeklySlots(slots: WeeklySlotInput[]): string | null {
  for (const slot of slots) {
    if (slot.dayOfWeek < 0 || slot.dayOfWeek > 6) return 'dayOfWeek must be 0–6 (Пн–Вс)';
    if (timeToMinutes(slot.endTime) <= timeToMinutes(slot.startTime)) {
      return 'Конец рабочего интервала должен быть позже начала';
    }
  }
  return null;
}

export async function POST(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      weekly?: WeeklySlotInput[];
      moves?: DayMoveInput[];
    };
    const weekly = body.weekly ?? [];
    const validationError = validateWeeklySlots(weekly);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const workingHours = await applyWeekWithMoves(
      auth.admin,
      auth.telegramId,
      weekly,
      body.moves ?? [],
    );

    revalidatePath('/cabinet/staff');
    return NextResponse.json({ workingHours });
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось сохранить шаблон' },
      { status: 500 },
    );
  }
}
