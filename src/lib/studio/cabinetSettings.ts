import { groq } from 'next-sanity';
import { getSanityClient } from './sanityClient';

export type CabinetTeacher = {
  teacherId: string;
  name: string;
  /** Telegram user id для auto-назначения после покупки (Sanity, не env). */
  telegramId: number | null;
};

export type CabinetCourseOffer = {
  description: string | null;
  priceByn: number;
};

export type CabinetLessonPackage = {
  name: string;
  prices: Record<string, number>;
  savingsChip?: string | null;
};

export type CabinetAchievementRuleKey = 'lesson_1' | 'webinar_3' | 'score_100' | 'hw_approved_1';

export type CabinetAchievementDef = {
  title: string;
  subtitle: string;
  ruleKey: CabinetAchievementRuleKey;
};

export type CabinetExamCountdown = {
  label: string;
  date: string;
};

export type CabinetQuote = {
  text: string;
  author: string;
};

export type CabinetPricing = {
  teachers: CabinetTeacher[];
  course: {
    label: string;
    offer: CabinetCourseOffer;
  };
  individual: {
    label: string;
    offerDescription: string | null;
    options: CabinetLessonPackage[];
  };
  group: {
    label: string;
    offerDescription: string | null;
    options: CabinetLessonPackage[];
  };
  exam: CabinetExamCountdown | null;
  achievements: CabinetAchievementDef[];
  /** Auto-назначение куратора при покупке курса. */
  defaultCuratorTelegramId: number | null;
  /** Цитаты боковой панели кабинета (ротация по дням). */
  quotes: CabinetQuote[];
};

export const DEFAULT_CABINET_QUOTES: CabinetQuote[] = [
  { text: 'Главное — не идеальность, а регулярность.', author: 'District' },
  { text: 'Каждая решённая задача — шаг к уверенности на экзамене.', author: 'District' },
  { text: 'Ошибки — не провал, а карта того, что стоит подтянуть.', author: 'District' },
  { text: 'Лучше 30 минут каждый день, чем 5 часов раз в неделю.', author: 'District' },
  { text: 'Формулы запоминаются, когда ими пользуешься.', author: 'District' },
  { text: 'Сложное становится простым, когда разбираешь его по шагам.', author: 'District' },
  { text: 'Прогресс заметнее, если смотреть на путь, а не только на результат.', author: 'District' },
  { text: 'Домашка — тренировка перед матчем, а не наказание.', author: 'District' },
  { text: 'Спроси, когда непонятно: так учатся быстрее.', author: 'District' },
  { text: 'Сегодняшняя практика — завтрашние баллы.', author: 'District' },
  { text: 'Не сравнивай себя с другими — сравнивай с собой вчерашним.', author: 'District' },
  { text: 'План без действий — мечта. Действия без плана — хаос.', author: 'District' },
  { text: 'Математика любит тех, кто возвращается к задачам снова.', author: 'District' },
  { text: 'Один понятый приём экономит часы на экзамене.', author: 'District' },
  { text: 'Дисциплина сегодня — спокойствие в день ЦТ.', author: 'District' },
];

export const DEFAULT_CABINET_ACHIEVEMENTS: CabinetAchievementDef[] = [
  { title: 'Первый шаг', subtitle: 'Пройди диагностику', ruleKey: 'lesson_1' },
  { title: 'Алгебра старт', subtitle: 'Посети 1 вебинар', ruleKey: 'lesson_1' },
  { title: 'Геометр мастер', subtitle: 'Пройди 3 вебинара', ruleKey: 'webinar_3' },
  { title: 'На пути к 100', subtitle: 'Набери 100 баллов', ruleKey: 'score_100' },
];

export const DEFAULT_CABINET_PRICING: CabinetPricing = {
  teachers: [
    { teacherId: 'kristina', name: 'Кристина Денисовна', telegramId: null },
    { teacherId: 'anna', name: 'Анна Сергеевна', telegramId: null },
  ],
  course: {
    label: 'Курс District',
    offer: {
      description: 'Полный доступ к программе подготовки к ЦТ',
      priceByn: 120,
    },
  },
  individual: {
    label: 'Индивидуальные',
    offerDescription:
      'Занятия 1-на-1 с преподавателем под твою цель и график. 60 минут, запись и конспект остаются у тебя.',
    options: [
      { name: '1 занятие', prices: { kristina: 25, anna: 22 } },
      { name: '4 занятия', prices: { kristina: 90, anna: 80 }, savingsChip: 'Экономия 10 BYN' },
      { name: '10 занятий', prices: { kristina: 200, anna: 180 }, savingsChip: 'Экономия 50 BYN' },
    ],
  },
  group: {
    label: 'Групповые',
    offerDescription:
      'Мини-группы: живое общение, разбор задач и мотивация. Преподаватель, материалы и домашки с проверкой.',
    options: [
      { name: '1 занятие', prices: { kristina: 15, anna: 13 } },
      { name: '4 занятия', prices: { kristina: 45, anna: 40 }, savingsChip: 'Экономия 15 BYN' },
      { name: '8 занятий', prices: { kristina: 80, anna: 70 }, savingsChip: 'Экономия 40 BYN' },
    ],
  },
  exam: {
    label: 'До ЦТ по математике',
    date: '2027-05-27',
  },
  defaultCuratorTelegramId: null,
  achievements: DEFAULT_CABINET_ACHIEVEMENTS,
  quotes: DEFAULT_CABINET_QUOTES,
};

const CABINET_SETTINGS_QUERY = groq`*[_type == "cabinetSettings" && _id == "cabinetSettings"][0]{
  teachers[]{ teacherId, name, telegramId },
  defaultCuratorTelegramId,
  courseOffer{ description, priceByn },
  coursePackages[]{ name, subtitle, isTrial, priceByn, lessonCount },
  individualPackages[]{ name, savingsChip, prices[]{ teacherId, priceByn } },
  groupPackages[]{ name, savingsChip, prices[]{ teacherId, priceByn } },
  individualOffer{ description },
  groupOffer{ description }
}`;

const CABINET_ASIDE_QUERY = groq`*[_type == "cabinetAsideSettings" && _id == "cabinetAsideSettings"][0]{
  cabinetQuotes[]{ text, author },
  achievements[]{ title, subtitle, ruleKey },
  examDate,
  examLabel
}`;

function mapLessonPackages(
  raw: { name?: string; savingsChip?: string | null; prices?: { teacherId?: string; priceByn?: number }[] }[] | null,
  teachers: CabinetTeacher[],
): CabinetLessonPackage[] {
  return (raw ?? [])
    .filter((item) => item?.name)
    .map((item) => {
      const prices: Record<string, number> = {};
      for (const p of item.prices ?? []) {
        if (p?.teacherId && typeof p.priceByn === 'number') {
          prices[p.teacherId] = p.priceByn;
        }
      }
      return {
        name: item.name as string,
        prices,
        savingsChip: item.savingsChip?.trim() ? item.savingsChip.trim() : null,
      };
    })
    .filter((item) => Object.keys(item.prices).length > 0);
}

function mapCourseOffer(raw: Record<string, unknown> | null): CabinetCourseOffer {
  const offer = raw?.courseOffer as { description?: string | null; priceByn?: number } | null | undefined;
  if (offer && typeof offer.priceByn === 'number') {
    return {
      description: offer.description ?? null,
      priceByn: offer.priceByn,
    };
  }

  const legacy = (raw?.coursePackages as { isTrial?: boolean; priceByn?: number; subtitle?: string | null; name?: string }[] | null) ?? [];
  const full = legacy.find((item) => !item.isTrial) ?? legacy[0];
  if (full && typeof full.priceByn === 'number') {
    return {
      description: full.subtitle ?? full.name ?? DEFAULT_CABINET_PRICING.course.offer.description,
      priceByn: full.priceByn,
    };
  }

  return DEFAULT_CABINET_PRICING.course.offer;
}

function mapQuotes(raw: { text?: string; author?: string }[] | null | undefined): CabinetQuote[] {
  const quotes = (raw ?? [])
    .filter((q) => typeof q?.text === 'string' && q.text.trim())
    .map((q) => ({
      text: q.text!.trim(),
      author: (q.author?.trim() || 'District') as string,
    }));
  return quotes.length > 0 ? quotes : DEFAULT_CABINET_QUOTES;
}

function mapAchievements(
  raw: { title?: string; subtitle?: string; ruleKey?: string }[] | null | undefined,
): CabinetAchievementDef[] {
  const achievements = (raw ?? [])
    .filter((item) => item?.title && item?.subtitle && item?.ruleKey)
    .map((item) => ({
      title: item.title as string,
      subtitle: item.subtitle as string,
      ruleKey: item.ruleKey as CabinetAchievementRuleKey,
    }));
  return achievements.length > 0 ? achievements : DEFAULT_CABINET_ACHIEVEMENTS;
}

function mapExam(aside: Record<string, unknown> | null): CabinetExamCountdown | null {
  const examDate = typeof aside?.examDate === 'string' ? aside.examDate : null;
  const examLabel =
    typeof aside?.examLabel === 'string' && aside.examLabel.trim()
      ? aside.examLabel.trim()
      : DEFAULT_CABINET_PRICING.exam?.label ?? 'До ЦТ по математике';
  return examDate ? { label: examLabel, date: examDate } : DEFAULT_CABINET_PRICING.exam;
}

function normalizePricing(raw: Record<string, unknown> | null): Omit<CabinetPricing, 'quotes' | 'achievements' | 'exam'> {
  if (!raw) {
    const { quotes: _q, achievements: _a, exam: _e, ...rest } = DEFAULT_CABINET_PRICING;
    return rest;
  }

  const teachers = ((raw.teachers as { teacherId?: string; name?: string; telegramId?: number }[] | null) ?? [])
    .filter((t) => t?.teacherId && t?.name)
    .map((t) => ({
      teacherId: t.teacherId as string,
      name: t.name as string,
      telegramId:
        typeof t.telegramId === 'number' && Number.isFinite(t.telegramId) ? t.telegramId : null,
    }));

  const resolvedTeachers = teachers.length > 0 ? teachers : DEFAULT_CABINET_PRICING.teachers;
  const individualOptions = mapLessonPackages(
    raw.individualPackages as Parameters<typeof mapLessonPackages>[0],
    resolvedTeachers,
  );
  const groupOptions = mapLessonPackages(
    raw.groupPackages as Parameters<typeof mapLessonPackages>[0],
    resolvedTeachers,
  );

  const individualOffer = raw.individualOffer as { description?: string | null } | null | undefined;
  const groupOffer = raw.groupOffer as { description?: string | null } | null | undefined;

  return {
    teachers: resolvedTeachers,
    course: {
      label: DEFAULT_CABINET_PRICING.course.label,
      offer: mapCourseOffer(raw),
    },
    individual: {
      label: DEFAULT_CABINET_PRICING.individual.label,
      offerDescription:
        individualOffer?.description?.trim() ||
        DEFAULT_CABINET_PRICING.individual.offerDescription,
      options:
        individualOptions.length > 0 ? individualOptions : DEFAULT_CABINET_PRICING.individual.options,
    },
    group: {
      label: DEFAULT_CABINET_PRICING.group.label,
      offerDescription:
        groupOffer?.description?.trim() || DEFAULT_CABINET_PRICING.group.offerDescription,
      options: groupOptions.length > 0 ? groupOptions : DEFAULT_CABINET_PRICING.group.options,
    },
    defaultCuratorTelegramId:
      typeof raw.defaultCuratorTelegramId === 'number' && Number.isFinite(raw.defaultCuratorTelegramId)
        ? raw.defaultCuratorTelegramId
        : null,
  };
}

/** Цитата дня: индекс = день года по кругу. */
export function pickDailyCabinetQuote(quotes: CabinetQuote[], now = new Date()): CabinetQuote {
  const list = quotes.length > 0 ? quotes : DEFAULT_CABINET_QUOTES;
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  return list[((dayOfYear % list.length) + list.length) % list.length]!;
}

export async function getCabinetPricing(): Promise<CabinetPricing> {
  const client = getSanityClient();
  const [pricingRaw, asideRaw] = await Promise.all([
    client.fetch<Record<string, unknown> | null>(CABINET_SETTINGS_QUERY, {}, { cache: 'no-store' }),
    client.fetch<Record<string, unknown> | null>(CABINET_ASIDE_QUERY, {}, { cache: 'no-store' }),
  ]);

  const pricing = normalizePricing(pricingRaw);
  return {
    ...pricing,
    quotes: mapQuotes(
      (asideRaw?.cabinetQuotes as { text?: string; author?: string }[] | null) ?? null,
    ),
    achievements: mapAchievements(
      (asideRaw?.achievements as { title?: string; subtitle?: string; ruleKey?: string }[] | null) ??
        null,
    ),
    exam: mapExam(asideRaw),
  };
}

export function priceForTeacher(
  pkg: CabinetLessonPackage,
  teacherId: string,
  teachers: CabinetTeacher[],
): number | null {
  if (pkg.prices[teacherId] != null) return pkg.prices[teacherId];
  for (const teacher of teachers) {
    if (pkg.prices[teacher.teacherId] != null) return pkg.prices[teacher.teacherId];
  }
  const first = Object.values(pkg.prices)[0];
  return first ?? null;
}
