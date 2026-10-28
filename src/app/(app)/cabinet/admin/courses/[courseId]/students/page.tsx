import AdminCourseStudents from '@/components/admin/AdminCourseStudents';
import { requireAdminCourseBundle } from '@/lib/admin/course-page';
import { loadAdminCourseStudentsCached } from '@/lib/admin/course-students';

export const dynamic = 'force-dynamic';

export default async function AdminCourseStudentsPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const bundle = await requireAdminCourseBundle(courseId);
  const students = await loadAdminCourseStudentsCached(bundle.courseId, bundle.slug);

  return <AdminCourseStudents courseId={bundle.courseId} students={students} />;
}
