import { redirect } from 'next/navigation';

export default async function AdminTeacherScheduleRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ teacherId: string }>;
  searchParams: Promise<{ focusLesson?: string }>;
}) {
  const { teacherId } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams({ teacher: teacherId });
  if (sp.focusLesson) qs.set('focusLesson', sp.focusLesson);
  redirect(`/cabinet/admin/schedule?${qs.toString()}`);
}
