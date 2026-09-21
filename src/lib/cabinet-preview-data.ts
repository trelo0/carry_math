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

const BASE_LESSONS: CabinetData['lessons'] = [
  {
    id: 'u1',
    kind: 'individual',
    date: '24.09.2024',
    time: '18:30',
    topic: 'Квадратные уравнения',
    status: 'upcoming',
    paid: false,
    meetUrl: 'https://meet.google.com/demo-upcoming',
    materials: [],
    homework: null,
  },
  {
    id: 'd1',
    kind: 'individual',
    date: '20.09.2024',
    time: '18:30',
    topic: 'Дробно-рациональные выражения',
    status: 'done',
    paid: true,
    meetUrl: null,
    materials: [
      {
        id: 1,
        name: 'Презентация.pdf',
        size: '2.1 MB',
        downloadUrl: '/api/cabinet/lessons/d1/files/1?kind=material',
      },
    ],
    homework: {
      id: 1,
      name: 'ДЗ.pdf',
      size: '0.8 MB',
      state: 'Проверено',
      tone: 'ok',
      downloadUrl: '/api/cabinet/lessons/d1/files/1?kind=homework',
    },
  },
  {
    id: 'u3',
    kind: 'group',
    date: '05.10.2024',
    time: '17:00',
    topic: 'Групповой интенсив: параметры',
    status: 'upcoming',
    paid: false,
    meetUrl: null,
    materials: [],
    homework: null,
  },
  {
    id: 'd3',
    kind: 'group',
    date: '13.09.2024',
    time: '17:00',
    topic: 'Групповой интенсив: планиметрия',
    status: 'done',
    paid: true,
    meetUrl: null,
    materials: [
      {
        id: 2,
        name: 'Конспект.docx',
        size: '1.2 MB',
        downloadUrl: '/api/cabinet/lessons/d3/files/2?kind=material',
      },
    ],
    homework: {
      id: 2,
      name: 'ДЗ.pdf',
      size: '0.6 MB',
      state: 'Проверено',
      tone: 'ok',
      downloadUrl: '/api/cabinet/lessons/d3/files/2?kind=homework',
    },
  },
];

/** Демо-данные для /cabinet-preview (без Supabase). */
export function buildCabinetPreviewData(
  createdAt: string,
  variant: CourseCabinetState | 'lessons_only' = 'full',
): CabinetData {
  const enrollment =
    variant === 'preview' || variant === 'lessons_only'
      ? null
      : {
          courseId: COURSE_CATALOG.id,
          courseTitle: COURSE_CATALOG.title,
          status: 'active',
          startedAt: createdAt,
        };

  const accesses =
    variant === 'full'
      ? [
          { product: 'course' as const, expiresAt: null },
          { product: 'individual' as const, expiresAt: null },
          { product: 'group' as const, expiresAt: null },
        ]
      : variant === 'lessons_only'
        ? [
            { product: 'individual' as const, expiresAt: null },
            { product: 'group' as const, expiresAt: null },
          ]
        : variant === 'enrolled_locked'
          ? []
          : [];

  const accessHistory: CabinetData['accessHistory'] =
    variant === 'full'
      ? ['course', 'individual', 'group']
      : variant === 'lessons_only'
        ? ['individual', 'group']
        : variant === 'enrolled_locked'
          ? []
          : [];

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
    group: { title: '10 класс · Алгебра', teacherName: 'Анна Сергеевна' },
    mentors: [{ kind: 'teacher', name: 'Кристина Денисовна' }],
    lessons: BASE_LESSONS,
    packages:
      variant === 'full'
        ? [
            { id: '1', product: 'course', title: 'Курс District', sub: 'Алгебра + Геометрия', remaining: 5, total: 8, active: true },
            { id: '2', product: 'individual', title: 'Индивидуальные', sub: 'Кристина Денисовна', remaining: 2, total: 4, active: true },
          ]
        : variant === 'lessons_only'
          ? [
              { id: '2', product: 'individual', title: 'Индивидуальные', sub: 'Кристина Денисовна', remaining: 2, total: 4, active: true },
            ]
          : [],
    payments:
      variant === 'full'
        ? [
            { id: '1', date: '24.09.2026', title: 'Курс District', price: '120', status: 'paid' },
            { id: '2', date: '12.09.2026', title: 'Индивидуальные занятия', price: '90', status: 'paid' },
          ]
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
    courseMapViewed: variant !== 'preview' && variant !== 'lessons_only',
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
