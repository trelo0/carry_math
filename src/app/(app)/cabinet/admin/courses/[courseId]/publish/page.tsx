import AdminCourseAccess from '@/components/admin/AdminCourseAccess';
import { courseScopeFields, loadCourseDocs } from '@/lib/admin/course-docs';
import { requireAdminCourseBundle } from '@/lib/admin/course-page';
import { settingsWriteEnabled } from '@/lib/admin/settings-docs';

export const dynamic = 'force-dynamic';

export default async function AdminCourseSettingsPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const bundle = await requireAdminCourseBundle(courseId);
  const sanityId = bundle.sanityId;
  if (!sanityId) return null;

  const doc = (await loadCourseDocs([sanityId])).get(sanityId) ?? null;
  // Поля, которых нет в документе, показываем как значения по умолчанию из Sanity (каталог — да, закрыт — нет).
  const values = {
    ...(doc ?? {}),
    showInCatalog: doc?.showInCatalog !== false,
    courseClosed: doc?.courseClosed === true,
  };

  return (
    <AdminCourseAccess
      sanityId={sanityId}
      courseId={bundle.courseId}
      title={String(doc?.title ?? bundle.summary?.title ?? bundle.dbTitle)}
      fields={courseScopeFields('access').fields}
      doc={values}
      writeEnabled={settingsWriteEnabled()}
    />
  );
}
