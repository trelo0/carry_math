import { NextResponse } from 'next/server';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import {
  addTeacherBlockedDate,
  clearTeacherDay,
  loadTeacherWorkingHours,
  removeTeacherBlockedDate,
  saveTeacherWeeklyHours,
  setTeacherDayOverride,
  type WeeklySlotInput,
} from '@/lib/teacher/working-hours';
import { timeToMinutes } from '@/lib/teacher/schedule-utils';
import { findLessonsConflictingWithWeekly, findLessonsOutsideHours } from '@/lib/teacher/schedule-validation';
import { dateKey } from '@/lib/teacher/schedule-utils';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function lessonsConflict(count: number, lessonIds: number[]) {
  return NextResponse.json(
    {
      error:
        count === 1
          ? 'На этот день запланировано занятие вне рабочего времени — сначала перенесите его'
          : 'На этот день запланированы занятия вне рабочего времени — сначала перенесите их',
      lessonIds,
    },
    { status: 409 },
  );
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function validateWeeklySlots(slots: WeeklySlotInput[]): string | null {
  for (const slot of slots) {
    if (slot.dayOfWeek < 0 || slot.dayOfWeek > 6) {
      return 'dayOfWeek must be 0–6 (Пн–Вс)';
    }
    if (timeToMinutes(slot.endTime) <= timeToMinutes(slot.startTime)) {
      return 'Конец рабочего интервала должен быть позже начала';
    }
  }
  return null;
}

async function handleGet() {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return unauthorized();
  }

  const data = await loadTeacherWorkingHours(auth.admin, auth.telegramId);
  return NextResponse.json(data);
}

async function handlePut(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return unauthorized();
  }

  const body = (await request.json()) as { weekly?: WeeklySlotInput[] };
  const weekly = body.weekly ?? [];
  const validationError = validateWeeklySlots(weekly);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const outside = await findLessonsConflictingWithWeekly(
    auth.admin,
    auth.telegramId,
    weekly,
    dateKey(new Date()),
  );
  if (outside.length > 0) {
    return lessonsConflict(
      outside.length,
      outside.map((lesson) => lesson.id),
    );
  }

  const saved = await saveTeacherWeeklyHours(auth.admin, auth.telegramId, weekly);
  const workingHours = await loadTeacherWorkingHours(auth.admin, auth.telegramId);
  return NextResponse.json({ weekly: saved, workingHours });
}

async function handlePost(request: Request) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return unauthorized();
  }

  const body = (await request.json()) as {
    action?: 'block' | 'unblock' | 'setDayHours' | 'clearDay';
    blockedDate?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    note?: string;
    blockedId?: number;
  };

  if (body.action === 'block') {
    const blockedDate = body.blockedDate?.trim();
    if (!blockedDate) {
      return NextResponse.json({ error: 'blockedDate required' }, { status: 400 });
    }
    if (!DATE_RE.test(blockedDate)) {
      return NextResponse.json({ error: 'Некорректная дата' }, { status: 400 });
    }
    const outside = await findLessonsOutsideHours(auth.admin, auth.telegramId, blockedDate, null);
    if (outside.length > 0) {
      return lessonsConflict(
        outside.length,
        outside.map((lesson) => lesson.id),
      );
    }
    const row = await addTeacherBlockedDate(
      auth.admin,
      auth.telegramId,
      blockedDate,
      body.note?.trim() || null,
    );
    const workingHours = await loadTeacherWorkingHours(auth.admin, auth.telegramId);
    return NextResponse.json({ blocked: row, workingHours });
  }

  if (body.action === 'setDayHours') {
    const date = body.date?.trim() ?? '';
    const startTime = body.startTime?.trim() ?? '';
    const endTime = body.endTime?.trim() ?? '';
    if (!DATE_RE.test(date) || !TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
      return NextResponse.json({ error: 'Некорректная дата или время' }, { status: 400 });
    }
    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      return NextResponse.json({ error: 'Конец рабочего дня должен быть позже начала' }, { status: 400 });
    }
    const outside = await findLessonsOutsideHours(auth.admin, auth.telegramId, date, [
      { startTime, endTime },
    ]);
    if (outside.length > 0) {
      return lessonsConflict(
        outside.length,
        outside.map((lesson) => lesson.id),
      );
    }
    await setTeacherDayOverride(auth.admin, auth.telegramId, date, startTime, endTime);
    const workingHours = await loadTeacherWorkingHours(auth.admin, auth.telegramId);
    return NextResponse.json({ workingHours });
  }

  if (body.action === 'clearDay') {
    const date = body.date?.trim() ?? '';
    if (!DATE_RE.test(date)) {
      return NextResponse.json({ error: 'Некорректная дата' }, { status: 400 });
    }
    await clearTeacherDay(auth.admin, auth.telegramId, date);
    const workingHours = await loadTeacherWorkingHours(auth.admin, auth.telegramId);
    return NextResponse.json({ workingHours });
  }

  if (body.action === 'unblock') {
    const id = body.blockedId;
    if (!id || !Number.isFinite(id)) {
      return NextResponse.json({ error: 'blockedId required' }, { status: 400 });
    }
    await removeTeacherBlockedDate(auth.admin, auth.telegramId, id);
    const workingHours = await loadTeacherWorkingHours(auth.admin, auth.telegramId);
    return NextResponse.json({ ok: true, workingHours });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}


function failure(error: unknown) {
  console.error('[teacher/availability]', error);
  const message = error instanceof Error ? error.message : 'Не удалось сохранить';
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    return await handleGet();
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    return await handlePut(request);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    return await handlePost(request);
  } catch (error) {
    return failure(error);
  }
}
