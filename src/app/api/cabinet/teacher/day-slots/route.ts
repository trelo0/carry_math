import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { mapSlotRow, validateDaySlotTime } from '@/lib/teacher/day-slot-validation';
import { ScheduleValidationError } from '@/lib/teacher/schedule-validation';

function validationResponse(error: unknown) {
  if (error instanceof ScheduleValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  throw error;
}

export async function POST(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    slotDate?: string;
    startTime?: string;
    endTime?: string;
    slotKind?: 'extra' | 'blocked' | 'break';
    label?: string;
  };

  const slotDate = body.slotDate?.trim();
  const startTime = body.startTime?.trim();
  const endTime = body.endTime?.trim();
  const slotKind =
    body.slotKind === 'blocked' || body.slotKind === 'break' ? body.slotKind : 'extra';
  const label = body.label?.trim() || null;

  if (!slotDate || !startTime || !endTime) {
    return NextResponse.json({ error: 'slotDate, startTime, endTime required' }, { status: 400 });
  }

  try {
    await validateDaySlotTime(auth.admin, auth.telegramId, slotDate, startTime, endTime);
  } catch (error) {
    return validationResponse(error);
  }

  const insertRow: Record<string, unknown> = {
    teacher_telegram_id: auth.telegramId,
    slot_date: slotDate,
    start_time: startTime,
    end_time: endTime,
    slot_kind: slotKind,
    label,
  };

  const { data, error } = await auth.admin
    .from('teacher_day_slots')
    .insert(insertRow)
    .select('id, slot_date, start_time, end_time, slot_kind, label')
    .single();

  if (error) {
    if (String(error.message).includes('slot_kind')) {
      const fallback = await auth.admin
        .from('teacher_day_slots')
        .insert({
          teacher_telegram_id: auth.telegramId,
          slot_date: slotDate,
          start_time: startTime,
          end_time: endTime,
        })
        .select('id, slot_date, start_time, end_time')
        .single();
      if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 400 });
      revalidatePath('/cabinet/staff');
      return NextResponse.json({ slot: mapSlotRow({ ...fallback.data, slot_kind: 'extra', label: null }) });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  revalidatePath('/cabinet/staff');
  return NextResponse.json({ slot: mapSlotRow(data) });
}

export async function PATCH(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    slotId?: number;
    startTime?: string;
    endTime?: string;
  };

  const slotId = body.slotId;
  const startTime = body.startTime?.trim();
  const endTime = body.endTime?.trim();

  if (!slotId || !startTime || !endTime) {
    return NextResponse.json({ error: 'slotId, startTime, endTime required' }, { status: 400 });
  }

  const { data: existing, error: loadError } = await auth.admin
    .from('teacher_day_slots')
    .select('id, slot_date, slot_kind, label')
    .eq('id', slotId)
    .eq('teacher_telegram_id', auth.telegramId)
    .maybeSingle();

  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 400 });
  if (!existing) return NextResponse.json({ error: 'Слот не найден' }, { status: 404 });

  const slotDate = String(existing.slot_date);

  try {
    await validateDaySlotTime(auth.admin, auth.telegramId, slotDate, startTime, endTime, slotId);
  } catch (error) {
    return validationResponse(error);
  }

  const { data, error } = await auth.admin
    .from('teacher_day_slots')
    .update({ start_time: startTime, end_time: endTime })
    .eq('id', slotId)
    .eq('teacher_telegram_id', auth.telegramId)
    .select('id, slot_date, start_time, end_time, slot_kind, label')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  revalidatePath('/cabinet/staff');
  return NextResponse.json({ slot: mapSlotRow(data) });
}

export async function DELETE(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const slotId = new URL(request.url).searchParams.get('slotId');
  if (!slotId) {
    return NextResponse.json({ error: 'slotId required' }, { status: 400 });
  }

  const { error } = await auth.admin
    .from('teacher_day_slots')
    .delete()
    .eq('id', Number(slotId))
    .eq('teacher_telegram_id', auth.telegramId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  revalidatePath('/cabinet/staff');
  return NextResponse.json({ ok: true });
}
