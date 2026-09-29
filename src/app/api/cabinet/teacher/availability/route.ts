import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';

export async function GET() {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await auth.admin
    .from('teacher_availability')
    .select('id, day_of_week, start_time, end_time, kind')
    .eq('teacher_telegram_id', auth.telegramId)
    .order('day_of_week')
    .order('start_time');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    slots: (data ?? []).map((row) => ({
      id: row.id,
      dayOfWeek: row.day_of_week,
      startTime: String(row.start_time).slice(0, 5),
      endTime: String(row.end_time).slice(0, 5),
      kind: row.kind,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    dayOfWeek?: number;
    startTime?: string;
    endTime?: string;
    kind?: 'individual' | 'group' | 'both';
    blockedDate?: string;
    note?: string;
  };

  if (body.blockedDate) {
    const { data, error } = await auth.admin
      .from('teacher_blocked_dates')
      .insert({
        teacher_telegram_id: auth.telegramId,
        blocked_date: body.blockedDate,
        note: body.note?.trim() || null,
      })
      .select('id, blocked_date, note')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({
      blocked: {
        id: data.id,
        blockedDate: data.blocked_date,
        note: data.note,
      },
    });
  }

  const dayOfWeek = body.dayOfWeek;
  const startTime = body.startTime?.trim();
  const endTime = body.endTime?.trim();
  const kind = body.kind ?? 'both';
  if (dayOfWeek == null || dayOfWeek < 0 || dayOfWeek > 6 || !startTime || !endTime) {
    return NextResponse.json({ error: 'Invalid slot' }, { status: 400 });
  }
  if (startTime >= endTime) {
    return NextResponse.json({ error: 'Время начала должно быть раньше окончания' }, { status: 400 });
  }

  const { data, error } = await auth.admin
    .from('teacher_availability')
    .insert({
      teacher_telegram_id: auth.telegramId,
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
      kind,
    })
    .select('id, day_of_week, start_time, end_time, kind')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  revalidatePath('/cabinet/staff');
  return NextResponse.json({
    slot: {
      id: data.id,
      dayOfWeek: data.day_of_week,
      startTime: String(data.start_time).slice(0, 5),
      endTime: String(data.end_time).slice(0, 5),
      kind: data.kind,
    },
  });
}

export async function DELETE(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const slotId = searchParams.get('slotId');
  const blockedId = searchParams.get('blockedId');

  if (blockedId) {
    const { error } = await auth.admin
      .from('teacher_blocked_dates')
      .delete()
      .eq('id', Number(blockedId))
      .eq('teacher_telegram_id', auth.telegramId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (!slotId) {
    return NextResponse.json({ error: 'slotId or blockedId required' }, { status: 400 });
  }

  const { error } = await auth.admin
    .from('teacher_availability')
    .delete()
    .eq('id', Number(slotId))
    .eq('teacher_telegram_id', auth.telegramId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  revalidatePath('/cabinet/staff');
  return NextResponse.json({ ok: true });
}
