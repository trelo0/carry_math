import { redirect } from 'next/navigation';
import AdminCourseStaff from '@/components/admin/AdminCourseStaff';
import { getAdminCabinetContext } from '@/lib/admin/auth';
import { loadCourseStaffData } from '@/lib/admin/course-staff-admin';
import { requireAdminCourseBundle } from '@/lib/admin/course-page';
import { settingsWriteEnabled } from '@/lib/admin/settings-docs';

export const dynamic = 'force-dynamic';

export default async function AdminCourseTeamPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const bundle = await requireAdminCourseBundle(courseId);
  if (!bundle.sanityId) return null;
  const ctx = await getAdminCabinetContext();
  if (!ctx) redirect('/cabinet');

  const data = await loadCourseStaffData(ctx.admin, bundle.sanityId);

  return (
    <AdminCourseStaff
      key={bundle.sanityId}
      courseId={bundle.courseId}
      sanityId={bundle.sanityId}
      data={data}
      writeEnabled={settingsWriteEnabled()}
    />
  );
}
