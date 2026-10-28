import { redirect } from 'next/navigation';
import AdminScheduleWorkspace from '@/components/admin/AdminScheduleWorkspace';
import { getAdminCabinetContext } from '@/lib/admin/auth';
import { loadAdminTeacherRows } from '@/lib/admin/schedule-data';

export const dynamic = 'force-dynamic';

export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ login?: string; teacher?: string; focusLesson?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getAdminCabinetContext();
  if (!ctx) redirect('/cabinet');

  const focusParam = Number(sp.focusLesson);
  const focusLessonId = Number.isFinite(focusParam) && focusParam > 0 ? Math.trunc(focusParam) : null;

  let teacherParam = Number(sp.teacher);
  teacherParam = Number.isFinite(teacherParam) && teacherParam > 0 ? Math.trunc(teacherParam) : 0;

  // Ссылка на занятие другого преподавателя — открываем его расписание.
  if (focusLessonId && !teacherParam) {
    const { data: lesson } = await ctx.admin
      .from('scheduled_lessons')
      .select('teacher_telegram_id')
      .eq('id', focusLessonId)
      .maybeSingle();
    const tg = lesson?.teacher_telegram_id as number | undefined;
    if (typeof tg === 'number' && tg > 0) teacherParam = tg;
  }

  const teachers = await loadAdminTeacherRows(ctx).catch(() => []);
  const initialTeacherId =
    teacherParam && teachers.some((t) => t.telegramId === teacherParam) ? teacherParam : ctx.telegramId;

  return (
    <AdminScheduleWorkspace
      selfId={ctx.telegramId}
      selfName={ctx.displayName ?? 'Вы'}
      teachers={teachers}
      initialTeacherId={initialTeacherId}
      initialFocusLessonId={focusLessonId}
    />
  );
}
