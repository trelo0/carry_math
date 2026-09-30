import type { CabinetData, CourseCabinetState, CabinetCourseCatalog } from '@/lib/cabinet';
import { formatModulePeriodFromLessons, mapContentToCourseModules, mapContentToStructureStops } from '@/lib/cabinet';
import { DEFAULT_CABINET_PRICING, getCabinetPricing } from '@/lib/studio/cabinetSettings';
import { getDistrictCourseContent } from '@/lib/studio/courseContent';

const COURSE_CATALOG: CabinetCourseCatalog = {
  id: 1,
  title: 'Курс подготовки к ЦТ по математике',
  slug: 'district-course',
  description:
    'Полная подготовка к ЦТ по математике: от диагностики до пробного экзамена. Алгебра, геометрия, тригонометрия и комбинаторика в одной программе.',
  cabinetEyebrow: 'Курс',
  deliveryFormat: 'Онлайн',
  homeworkIntro:
    'Выполняй задания после каждого вебинара, чтобы закрепить материал и отслеживать прогресс по курсу.',
  coverImageUrl: null,
  previewImageUrl: '/prewiev.jpg',
  previewInsideItems: [
    'Базовый и углублённый уровень подготовки',
    'Регулярные вебинары и практика',
    'Домашние задания с разбором',
    'Поддержка преподавателя на каждом этапе',
  ],
  previewAfterEnrollment:
    'Программа курса откроется сразу после записи. Ты получишь доступ ко всем материалам и сможешь начать обучение в любой момент.',
  previewAudience:
    'Школьникам 10–11 классов, которые готовятся к ЦТ по математике и хотят получить высокий результат.',
  sanityId: null,
  curatorName: 'Кристина Денисовна',
  totalLessons: 74,
  modulePreviews: [
    {
      name: 'Диагностика',
      about: 'Стартовая проверка уровня.',
      count: 11,
      color: '#38c6ff',
      period: '14 сен – 11 окт',
      lessons: [],
    },
    {
      name: 'Алгебра',
      about: 'Уравнения и неравенства.',
      count: 11,
      color: '#4f7cff',
      period: '12 окт – 8 ноя',
      lessons: [],
    },
  ],
};

/** Демо-данные для /cabinet-preview (без Supabase). */
export function buildCabinetPreviewData(
  createdAt: string,
  variant: CourseCabinetState = 'full',
): CabinetData {
  const enrollment =
    variant === 'preview'
      ? null
      : {
          courseId: COURSE_CATALOG.id,
          courseTitle: COURSE_CATALOG.title,
          status: 'active',
          startedAt: createdAt,
        };

  const accesses =
    variant === 'full'
      ? [{ product: 'course' as const, expiresAt: null }]
      : variant === 'enrolled_locked'
        ? []
        : [];

  const accessHistory: CabinetData['accessHistory'] =
    variant === 'full' ? ['course'] : variant === 'enrolled_locked' ? [] : [];

  return {
    phone: '+7 700 000-00-00',
    createdAt,
    studentName: 'Иван Петров',
    telegramLinked: true,
    accesses,
    accessHistory,
    enrollment,
    courseCatalog: COURSE_CATALOG,
    courseContent: null,
    mentors: [{ kind: 'curator', name: 'Кристина Денисовна' }],
    hasOrdinaryStudentTrack: false,
    packages:
      variant === 'full'
        ? [
            {
              id: '1',
              product: 'course',
              title: 'Курс District',
              sub: 'Алгебра + Геометрия',
              remaining: 5,
              total: 8,
              active: true,
            },
          ]
        : [],
    payments:
      variant === 'full'
        ? [{ id: '1', date: '24.09.2026', title: 'Курс District', price: '120', status: 'paid' }]
        : [],
    profile: {
      name: 'Иван Петров',
      klass: '10',
      goal: 'Подготовка к ЦТ',
      resultType: 'ct',
      resultValue: 90,
    },
    courseProgress: [],
    courseModules: [],
    courseStops: [],
    lives: variant === 'enrolled_locked' || variant === 'full' ? { current: 2, max: 3, accessBlocked: false } : null,
    cabinetPricing: DEFAULT_CABINET_PRICING,
    courseMapViewed: variant !== 'preview',
    memberRoles: ['student'],
  };
}

/** Подмешивает реальный контент курса и цены из Sanity в dev-превью. */
export async function enrichCabinetPreviewWithSanity(data: CabinetData): Promise<CabinetData> {
  const [courseContent, cabinetPricing] = await Promise.all([
    getDistrictCourseContent().catch(() => null),
    getCabinetPricing().catch(() => data.cabinetPricing),
  ]);

  const next: CabinetData = {
    ...data,
    courseContent,
    cabinetPricing,
  };

  if (courseContent?.modules.length) {
    next.courseModules = mapContentToCourseModules(courseContent);
    next.courseStops = mapContentToStructureStops(courseContent);
    next.courseCatalog = {
      id: next.courseCatalog?.id ?? 1,
      title: courseContent.title,
      slug: courseContent.slug,
      description: courseContent.description,
      cabinetEyebrow: courseContent.cabinetEyebrow,
      deliveryFormat: courseContent.deliveryFormat,
      homeworkIntro: courseContent.homeworkIntro,
      coverImageUrl: courseContent.coverImageUrl,
      previewImageUrl: courseContent.previewImageUrl,
      previewInsideItems: courseContent.previewInsideItems,
      previewAfterEnrollment: courseContent.previewAfterEnrollment,
      previewAudience: courseContent.previewAudience,
      sanityId: courseContent.sanityId,
      curatorName: courseContent.curatorName,
      totalLessons: courseContent.modules.reduce(
        (sum, m) => sum + m.lessons.filter((l) => l.publicationStatus === 'published').length,
        0,
      ),
      modulePreviews: courseContent.modules.map((m) => {
        const visibleLessons = m.lessons.filter((l) => l.publicationStatus !== 'archived');
        return {
          name: m.title,
          about: m.description ?? '',
          count: visibleLessons.length,
          color: m.color,
          period: formatModulePeriodFromLessons(m.lessons),
          lessons: visibleLessons.map((l) => ({ title: l.title })),
        };
      }),
    };
  }

  return next;
}
