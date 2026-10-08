import type { CabinetData, CourseCabinetState, CabinetCourseCatalog } from '@/lib/cabinet';
import { formatModulePeriodFromLessons, mapContentToCourseModules, mapContentToStructureStops } from '@/lib/cabinet';
import {
  DEFAULT_CABINET_PRICING,
  getCabinetPricing,
  pickDailyCabinetQuote,
} from '@/lib/studio/cabinetSettings';
import { getDistrictCourseContent, listDistrictCourseSummaries } from '@/lib/studio/courseContent';

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
    { title: 'Системная подготовка', description: 'От базы до сложных задач' },
    { title: 'Теория + практика', description: 'Только то, что реально нужно' },
    { title: 'Проверка заданий', description: 'Развёрнутая обратная связь' },
    { title: 'Актуальные задания ЦЭ/ЦТ', description: 'Реальные форматы и критерии' },
  ],
  previewAfterEnrollment:
    'Программа курса откроется сразу после записи. Ты получишь доступ ко всем материалам и сможешь начать обучение в любой момент.',
  previewAudience:
    'Школьникам 10–11 классов, которые готовятся к ЦТ по математике и хотят получить высокий результат.',
  sanityId: null,
  curatorName: 'Кристина Денисовна',
  totalLessons: 74,
  modulesCount: 2,
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
    courseEnrollments: enrollment ? [enrollment] : [],
    courseCatalog: COURSE_CATALOG,
    courseCatalogs: [COURSE_CATALOG],
    courseContent: null,
    dailyQuote: pickDailyCabinetQuote(DEFAULT_CABINET_PRICING.quotes),
    coursePaymentOffers: [
      {
        sanityId: 'preview-course',
        slug: 'district-course',
        title: 'Курс District',
        description: 'Полный доступ к программе подготовки',
        cardText: 'Полный доступ к программе подготовки',
        priceByn: 120,
        grantedLessons: 8,
      },
    ],
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
  const [courseContent, cabinetPricing, summaries] = await Promise.all([
    getDistrictCourseContent().catch(() => null),
    getCabinetPricing().catch(() => data.cabinetPricing),
    listDistrictCourseSummaries().catch(() => []),
  ]);

  const next: CabinetData = {
    ...data,
    courseContent,
    cabinetPricing,
    dailyQuote: pickDailyCabinetQuote(cabinetPricing.quotes),
  };

  if (summaries.length > 0) {
    next.courseCatalogs = summaries.map((s, i) => ({
      id: i + 1,
      title: s.title,
      slug: s.slug,
      description: s.description,
      cabinetEyebrow: s.cabinetEyebrow,
      deliveryFormat: s.deliveryFormat,
      homeworkIntro: s.homeworkIntro,
      coverImageUrl: s.coverImageUrl,
      previewImageUrl: s.previewImageUrl,
      previewInsideItems: s.previewInsideItems,
      previewAfterEnrollment: s.previewAfterEnrollment,
      previewAudience: s.previewAudience,
      sanityId: s.sanityId,
      curatorName: s.curatorName,
      totalLessons: s.totalLessons || s.modulePreviews.reduce((sum, m) => sum + m.count, 0),
      modulesCount: s.moduleCount || s.modulePreviews.length,
      modulePreviews: s.modulePreviews,
    }));
  }

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
      modulesCount: courseContent.modules.length,
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
    if (!next.courseCatalogs.some((c) => c.slug === next.courseCatalog!.slug)) {
      next.courseCatalogs = [next.courseCatalog, ...next.courseCatalogs];
    }
  }

  return next;
}
