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
};

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
  achievements: [
    { title: 'Первый шаг', subtitle: 'Пройди диагностику', ruleKey: 'lesson_1' },
    { title: 'Алгебра старт', subtitle: 'Посети 1 вебинар', ruleKey: 'lesson_1' },
    { title: 'Геометр мастер', subtitle: 'Пройди 3 вебинара', ruleKey: 'webinar_3' },
    { title: 'На пути к 100', subtitle: 'Набери 100 баллов', ruleKey: 'score_100' },
  ],
};

const CABINET_SETTINGS_QUERY = groq`*[_type == "cabinetSettings" && _id == "cabinetSettings"][0]{
  teachers[]{ teacherId, name, telegramId },
  defaultCuratorTelegramId,
  courseOffer{ description, priceByn },
  coursePackages[]{ name, subtitle, isTrial, priceByn, lessonCount },
  individualPackages[]{ name, savingsChip, prices[]{ teacherId, priceByn } },
  groupPackages[]{ name, savingsChip, prices[]{ teacherId, priceByn } },
  individualOffer{ description },
  groupOffer{ description },
  examDate,
  examLabel,
  achievements[]{ title, subtitle, ruleKey }
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

function normalize(raw: Record<string, unknown> | null): CabinetPricing {
  if (!raw) return DEFAULT_CABINET_PRICING;

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
  const examDate = typeof raw.examDate === 'string' ? raw.examDate : null;
  const examLabel =
    typeof raw.examLabel === 'string' && raw.examLabel.trim()
      ? raw.examLabel.trim()
      : DEFAULT_CABINET_PRICING.exam?.label ?? 'До ЦТ по математике';

  const achievementsRaw = (raw.achievements as { title?: string; subtitle?: string; ruleKey?: string }[] | null) ?? [];
  const achievements = achievementsRaw
    .filter((item) => item?.title && item?.subtitle && item?.ruleKey)
    .map((item) => ({
      title: item.title as string,
      subtitle: item.subtitle as string,
      ruleKey: item.ruleKey as CabinetAchievementRuleKey,
    }));

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
    exam: examDate
      ? { label: examLabel, date: examDate }
      : DEFAULT_CABINET_PRICING.exam,
    achievements: achievements.length > 0 ? achievements : DEFAULT_CABINET_PRICING.achievements,
    defaultCuratorTelegramId:
      typeof raw.defaultCuratorTelegramId === 'number' && Number.isFinite(raw.defaultCuratorTelegramId)
        ? raw.defaultCuratorTelegramId
        : null,
  };
}

export async function getCabinetPricing(): Promise<CabinetPricing> {
  const client = getSanityClient();
  const raw = await client.fetch<Record<string, unknown> | null>(
    CABINET_SETTINGS_QUERY,
    {},
    { cache: 'no-store' },
  );
  return normalize(raw);
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
