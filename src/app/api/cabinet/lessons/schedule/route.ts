import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  LessonScheduleError,
  scheduleStudentLesson,
  type ScheduleHomeworkInput,
  type ScheduleMaterialInput,
  type ScheduleStudentLessonInput,
} from '@/lib/bot/lesson-scheduling';

export const dynamic = 'force-dynamic';

type Body = {
  telegramId?: number;
  kind?: string;
  startsAt?: string;
  topic?: string;
  packageId?: number;
  meetUrl?: string;
  teacherTelegramId?: number;
  groupId?: number;
  durationMinutes?: number;
  materials?: ScheduleMaterialInput[];
  homework?: ScheduleHomeworkInput;
};

function parseKind(value: string | undefined): ScheduleStudentLessonInput['kind'] | null {
  if (value === 'individual' || value === 'group') return value;
  return null;
}

/** Ручное назначение занятия до бота/эквайринга. Тот же секрет, что у purchase/fulfill. */
export async function POST(request: Request) {
  const secret = process.env.PURCHASE_FULFILL_SECRET;
  const headerSecret = request.headers.get('x-fulfill-secret');
  if (!secret || headerSecret !== secret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const kind = parseKind(body.kind);
  if (!kind || typeof body.telegramId !== 'number' || !body.startsAt || !body.topic) {
    return NextResponse.json(
      { error: 'Required: telegramId, kind, startsAt, topic' },
      { status: 400 },
    );
  }

  try {
    const admin = createAdminClient();
    const result = await scheduleStudentLesson(admin, body.telegramId, {
      kind,
      startsAt: body.startsAt,
      topic: body.topic,
      packageId: body.packageId,
      meetUrl: body.meetUrl,
      teacherTelegramId: body.teacherTelegramId,
      groupId: body.groupId,
      durationMinutes: body.durationMinutes,
      materials: body.materials,
      homework: body.homework,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LessonScheduleError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    console.error('[lessons/schedule]', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
