import AdminCoursePricing from '@/components/admin/AdminCoursePricing';
import { courseScopeFields, loadCourseDocs } from '@/lib/admin/course-docs';
import { requireAdminCourseBundle } from '@/lib/admin/course-page';
import { settingsWriteEnabled } from '@/lib/admin/settings-docs';

export const dynamic = 'force-dynamic';

export default async function AdminCoursePricingPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const bundle = await requireAdminCourseBundle(courseId);
  const sanityId = bundle.sanityId;
  if (!sanityId) return null;

  const doc = (await loadCourseDocs([sanityId])).get(sanityId) ?? null;

  return (
    <AdminCoursePricing
      sanityId={sanityId}
      fields={courseScopeFields('pricing').fields}
      doc={doc}
      writeEnabled={settingsWriteEnabled()}
    />
  );
}
