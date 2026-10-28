import AdminCourseOverview from '@/components/admin/AdminCourseOverview';
import { courseScopeFields, loadCourseDocs, slugOf } from '@/lib/admin/course-docs';
import { requireAdminCourseBundle } from '@/lib/admin/course-page';
import { settingsWriteEnabled } from '@/lib/admin/settings-docs';

export const dynamic = 'force-dynamic';

export default async function AdminCourseOverviewPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const bundle = await requireAdminCourseBundle(courseId);
  const sanityId = bundle.sanityId;
  if (!sanityId) return null;

  const doc = (await loadCourseDocs([sanityId])).get(sanityId) ?? null;
  const { fields } = courseScopeFields('overview');

  return (
    <AdminCourseOverview
      sanityId={sanityId}
      slug={slugOf(doc) || bundle.slug}
      fields={fields}
      doc={doc}
      writeEnabled={settingsWriteEnabled()}
    />
  );
}
