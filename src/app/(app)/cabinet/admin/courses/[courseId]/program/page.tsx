import AdminCourseProgram from '@/components/admin/AdminCourseProgram';
import { courseScopeFields, loadCourseProgramCached } from '@/lib/admin/course-docs';
import { requireAdminCourseBundle } from '@/lib/admin/course-page';
import { settingsWriteEnabled } from '@/lib/admin/settings-docs';

export const dynamic = 'force-dynamic';

export default async function AdminCourseProgramPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const bundle = await requireAdminCourseBundle(courseId);
  if (!bundle.sanityId) return null;

  const modules = await loadCourseProgramCached(bundle.sanityId);

  return (
    <AdminCourseProgram
      courseSanityId={bundle.sanityId}
      modules={modules}
      moduleFields={courseScopeFields('module').fields}
      lessonFields={courseScopeFields('lesson').fields}
      writeEnabled={settingsWriteEnabled()}
    />
  );
}
