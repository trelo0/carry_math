import Link from 'next/link';
import AdminCourseSubNav from '@/components/admin/AdminCourseSubNav';
import { courseAccess } from '@/lib/admin/course-access';
import { requireAdminCourseBundle } from '@/lib/admin/course-page';

export const dynamic = 'force-dynamic';

export default async function AdminCourseRouteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ courseId: string }>;
}) {
  const { courseId: raw } = await params;
  const bundle = await requireAdminCourseBundle(raw);
  const { summary } = bundle;
  const title = summary?.title ?? bundle.dbTitle;
  const description = summary?.description ?? null;
  const cover = summary?.previewImageUrl ?? summary?.coverImageUrl ?? null;
  const access = courseAccess({
    courseClosed: summary?.courseClosed === true,
    showInCatalog: summary?.showInCatalog !== false,
    publicationStatus: summary?.publicationStatus,
  });
  const hue = (bundle.courseId * 53) % 360;

  return (
    <div className="admin-course">
      <div className="admin-course__head">
        <Link href="/cabinet/admin/courses" className="admin-course__back" aria-label="Все курсы" prefetch={false}>
          ←
        </Link>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="admin-courses__icon admin-courses__icon--lg" src={cover} alt="" />
        ) : (
          <span
            className="admin-courses__icon admin-courses__icon--lg"
            style={{ background: `hsl(${hue} 55% 42%)` }}
            aria-hidden
          >
            {title.trim().slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="admin-course__titles">
          <div className="admin-course__title-row">
            <h2 className="admin-course__title">{title}</h2>
            <span className={`admin-courses__access admin-courses__access--${access.tone}`}>{access.label}</span>
          </div>
          <p className="admin-course__desc" title={bundle.slug}>
            {description ?? bundle.slug}
          </p>
        </div>
      </div>
      {summary ? (
        <>
          <AdminCourseSubNav courseId={bundle.courseId} />
          {children}
        </>
      ) : (
        <div className="admin-panel__card admin-panel__empty">
          <p className="admin-panel__empty-title">Курс не найден в Sanity</p>
          <p className="admin-panel__empty-text">
            Запись «{bundle.slug}» есть в базе, но документа в Sanity нет (или он не опубликован).
          </p>
        </div>
      )}
    </div>
  );
}
