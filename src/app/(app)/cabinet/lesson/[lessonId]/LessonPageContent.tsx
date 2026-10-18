import Link from 'next/link';
import { getCabinetLessonPageData, isCabinetLessonContentOpen } from '@/lib/cabinet';
import CabinetTelegramGate from '@/components/cabinet/CabinetTelegramGate';
import CabinetLessonDetail from '@/components/cabinet/CabinetLessonDetail';
import CabinetLessonBackLink from '@/components/cabinet/CabinetLessonBackLink';

export async function LessonPageContent({
  phone,
  lessonId,
  courseSlug,
}: {
  phone: string;
  lessonId: string;
  courseSlug?: string;
}) {
  const pageData = await getCabinetLessonPageData(phone, lessonId, courseSlug);
  if (!pageData) return <CabinetTelegramGate />;

  const { stop, courseModules, courseCatalog, courseState } = pageData;
  const locked = !isCabinetLessonContentOpen(stop, courseState);
  const module = courseModules[stop.module] ?? null;

  return (
    <div className="cab-lespage">
      <div className="cab-lespage-inner">
        <header className="cab-lespage-head">
          <CabinetLessonBackLink />
          <span className="cab-k">
            {`M${stop.module + 1} · ${String(stop.numInModule).padStart(2, '0')} · ${module?.name ?? 'Модуль'}`}
          </span>
          <h1>{stop.title}</h1>
        </header>

        {locked ? (
          <section className="cab-panel cab-lespage-locked">
            <h2>Занятие пока закрыто</h2>
            <p>
              Пройдите предыдущие занятия и сдайте ДЗ, либо оплатите пакет занятий, чтобы открыть
              следующее.
            </p>
            <Link className="cab-btn cab-btn--join" href="/cabinet?section=payments&product=course">
              Оплатить занятия
            </Link>
          </section>
        ) : (
          <CabinetLessonDetail
            stop={stop}
            coverUrl={courseCatalog?.coverImageUrl ?? courseCatalog?.previewImageUrl ?? null}
            coursePurchased={pageData.courseState === 'full'}
          />
        )}
      </div>
    </div>
  );
}
