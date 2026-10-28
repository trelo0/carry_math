import { redirect } from 'next/navigation';

export default async function AdminCourseIndexPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  redirect(`/cabinet/admin/courses/${courseId}/overview`);
}
