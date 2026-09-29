import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getStaffAuth } from '@/lib/cabinet-auth';
import { canManageTeacherCabinet } from '@/lib/bot/roles';
import { teacherOwnsStudent } from '@/lib/teacher/teacher-access';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ telegramId: string }> },
) {
  const auth = await getStaffAuth();
  if (!auth || !canManageTeacherCabinet(auth.roles, auth.telegramId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { telegramId } = await params;
  const studentTelegramId = Number(telegramId);
  if (!Number.isFinite(studentTelegramId)) {
    return NextResponse.json({ error: 'Invalid student id' }, { status: 400 });
  }

  const ownsStudent = await teacherOwnsStudent(auth.admin, auth.telegramId, studentTelegramId);
  if (!ownsStudent) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 });
  }

  const body = (await request.json()) as { notes?: string };
  const notes = body.notes?.trim() ?? '';

  const { error } = await auth.admin.from('teacher_student_notes').upsert(
    {
      teacher_telegram_id: auth.telegramId,
      student_telegram_id: studentTelegramId,
      notes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'teacher_telegram_id,student_telegram_id' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  revalidatePath('/cabinet/staff');
  return NextResponse.json({ ok: true });
}
