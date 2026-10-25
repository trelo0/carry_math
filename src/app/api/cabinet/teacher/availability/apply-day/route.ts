import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { ScheduleValidationError } from '@/lib/teacher/schedule-validation';
import { applyDayWithMoves, type DayMoveInput } from '@/lib/teacher/apply-day-with-moves';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      date?: string;
      mode?: 'work' | 'off';
      startTime?: string;
      endTime?: string;
      note?: string | null;
      moves?: DayMoveInput[];
    };

    const date = body.date?.trim() ?? '';
    if (!DATE_RE.test(date)) {
      return NextResponse.json({ error: 'Некорректная дата' }, { status: 400 });
    }
    const mode = body.mode === 'off' ? 'off' : 'work';
    if (mode === 'work' && (!body.startTime?.trim() || !body.endTime?.trim())) {
      return NextResponse.json({ error: 'Укажите начало и конец рабочего дня' }, { status: 400 });
    }

    const workingHours = await applyDayWithMoves(auth.admin, auth.telegramId, {
      date,
      mode,
      startTime: body.startTime?.trim(),
      endTime: body.endTime?.trim(),
      note: body.note ?? null,
      moves: body.moves ?? [],
    });

    revalidatePath('/cabinet/staff');
    return NextResponse.json({ workingHours });
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось сохранить' },
      { status: 500 },
    );
  }
}
