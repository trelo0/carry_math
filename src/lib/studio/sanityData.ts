// src/lib/studio/sanityData.ts
import { cache } from 'react';
import { groq } from 'next-sanity';
import { Principle, ProcessStep, Stat, Teacher } from '@/data/types';
import type { MainPageContent } from '@/data/mainPageContent';
import type { IndividualPageContent } from '@/data/individualPageContent';
import { getSanityClient } from './sanityClient';

type FetchOptions = {
  preview?: boolean;
};

function getClient({ preview }: FetchOptions = {}) {
  return getSanityClient({ preview });
}

function getSanityFetchOptions({ preview }: FetchOptions, tags: string[]) {
  if (preview) return { cache: 'no-store' as const }

  const isDev = process.env.NODE_ENV !== 'production'
  return {
    next: {
      tags,
      revalidate: isDev ? 30 : 60,
    },
  }
}

type SanityFetchOptions = ReturnType<typeof getSanityFetchOptions>

async function safeSanityFetch<T>(
  client: ReturnType<typeof getSanityClient>,
  query: string,
  params: Record<string, unknown>,
  options: SanityFetchOptions,
  fallback: T,
): Promise<T> {
  try {
    return (await client.fetch<T>(query, params, options)) ?? fallback
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const authHint =
      message.includes('403') || message.includes('401')
        ? ' Проверьте SANITY_API_READ_TOKEN (или SANITY_API_WRITE_TOKEN) в .env.local — создайте новый токен в sanity.io/manage → API → Tokens.'
        : ''
    console.error(`[Sanity] fetch failed:${authHint}`, message.split('\n')[0])
    return fallback
  }
}

export type SiteSettings = {
  title: string;
  footerDescription?: string;
  instagramUrl?: string;
  headerButtonText?: string;
  heroButtonText?: string;
  teacherCardButtonText?: string;
  modalTitle?: string;
  modalSubmitButtonText?: string;
};

export async function getSiteSettings({ preview }: FetchOptions = {}): Promise<SiteSettings | null> {
  return getSiteSettingsCached(Boolean(preview));
}

const getSiteSettingsCached = cache(async (preview: boolean): Promise<SiteSettings | null> => {
  const client = getClient({ preview });
  return safeSanityFetch(
    client,
    groq`*[_type == "siteSettings"] | order(_updatedAt desc)[0]{
      title,
      footerDescription,
      instagramUrl,
      headerButtonText,
      heroButtonText,
      teacherCardButtonText,
      modalTitle,
      modalSubmitButtonText
    }`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:siteSettings']),
    null,
  );
});

// Контент страницы «Индивидуальные занятия» (/individual): все блоки одним запросом.
// Любой блок может отсутствовать в Sanity — на клиенте подставляются дефолты.
export async function getIndividualPageContent({
  preview,
}: FetchOptions = {}): Promise<IndividualPageContent | null> {
  return getIndividualPageContentCached(Boolean(preview));
}

const getIndividualPageContentCached = cache(async (preview: boolean): Promise<IndividualPageContent | null> => {
  const client = getClient({ preview });
  return safeSanityFetch(
    client,
    groq`{
      "hero": *[_type == "individualHeroBlock"] | order(_updatedAt desc)[0]{
        kicker,
        title,
        description,
        panelTitle,
        slots[]{ _key, icon, title, sub, href }
      },
      "teachers": *[_type == "teachersBlock"] | order(_updatedAt desc)[0]{
        kicker,
        sectionTitle,
        badges
      },
      "principles": *[_type == "principlesBlock"] | order(_updatedAt desc)[0]{
        kicker,
        sectionTitle,
        sectionTitleGold,
        sectionSubtitle
      },
      "formats": *[_type == "formatsBlock"] | order(_updatedAt desc)[0]{
        kicker,
        sectionTitle,
        columns[]{ _key, icon, title, sub, description, perks, ctaText }
      },
      "process": *[_type == "processBlock"] | order(_updatedAt desc)[0]{
        kicker,
        sectionTitle,
        sectionSubtitle
      },
      "choosePath": *[_type == "choosePathBlock"] | order(_updatedAt desc)[0]{
        kicker,
        sectionTitle,
        sectionTitleGold,
        soloTabText,
        groupTabText,
        trialGuideTitle,
        trialGuideText,
        benefits[]{ _key, title, text }
      },
      "diagnostic": *[_type == "diagnosticBlock"] | order(_updatedAt desc)[0]{
        eyebrow,
        title,
        text,
        buttonText,
        steps[]{ _key, title, text }
      }
    }`,
    {},
    getSanityFetchOptions({ preview }, [
      'sanity:individualHeroBlock',
      'sanity:teachersBlock',
      'sanity:principlesBlock',
      'sanity:formatsBlock',
      'sanity:processBlock',
      'sanity:choosePathBlock',
      'sanity:diagnosticBlock',
    ]),
    null,
  );
});

export type IndividualPageBundle = {
  content: IndividualPageContent | null;
  teachers: Teacher[];
  stats: Stat[];
  principles: Principle[];
  processSteps: ProcessStep[];
};

// Весь контент /individual одним запросом к Sanity (вместо 5 параллельных).
export async function getIndividualPageBundle({
  preview,
}: FetchOptions = {}): Promise<IndividualPageBundle> {
  return getIndividualPageBundleCached(Boolean(preview));
}

const getIndividualPageBundleCached = cache(async (preview: boolean): Promise<IndividualPageBundle> => {
  const client = getClient({ preview });
  const empty: IndividualPageBundle = {
    content: null,
    teachers: [],
    stats: [],
    principles: [],
    processSteps: [],
  };

  return safeSanityFetch(
    client,
    groq`{
      "content": {
        "hero": *[_type == "individualHeroBlock"] | order(_updatedAt desc)[0]{
          kicker, title, description, panelTitle,
          slots[]{ _key, icon, title, sub, href }
        },
        "teachers": *[_type == "teachersBlock"] | order(_updatedAt desc)[0]{
          kicker, sectionTitle, badges
        },
        "principles": *[_type == "principlesBlock"] | order(_updatedAt desc)[0]{
          kicker, sectionTitle, sectionTitleGold, sectionSubtitle
        },
        "formats": *[_type == "formatsBlock"] | order(_updatedAt desc)[0]{
          kicker, sectionTitle,
          columns[]{ _key, icon, title, sub, description, perks, ctaText }
        },
        "process": *[_type == "processBlock"] | order(_updatedAt desc)[0]{
          kicker, sectionTitle, sectionSubtitle
        },
        "choosePath": *[_type == "choosePathBlock"] | order(_updatedAt desc)[0]{
          kicker, sectionTitle, sectionTitleGold,
          soloTabText, groupTabText, trialGuideTitle, trialGuideText,
          benefits[]{ _key, title, text }
        },
        "diagnostic": *[_type == "diagnosticBlock"] | order(_updatedAt desc)[0]{
          eyebrow, title, text, buttonText,
          steps[]{ _key, title, text }
        }
      },
      "teachers": *[_type == "teacher"]{
        _id, name, subject, description, photo, badges,
        "hasSpots": hasSpots, services, trialLesson,
        reviews[]{ _key, image, caption }
      },
      "stats": *[_type == "stat"]{
        _id, value, label, order
      } | order(coalesce(order, 9999) asc, _createdAt asc),
      "principles": *[_type == "principle"]{
        _id, title, description, order
      } | order(coalesce(order, 9999) asc, _createdAt asc),
      "processSteps": *[_type == "processStep"]{
        _id, title, description
      } | order(coalesce(order, 9999) asc, _createdAt asc)
    }`,
    {},
    getSanityFetchOptions({ preview }, [
      'sanity:individualHeroBlock',
      'sanity:teachersBlock',
      'sanity:principle',
      'sanity:principlesBlock',
      'sanity:formatsBlock',
      'sanity:processBlock',
      'sanity:choosePathBlock',
      'sanity:diagnosticBlock',
      'sanity:teacher',
      'sanity:stat',
      'sanity:processStep',
    ]),
    empty,
  );
});

export const getTeachers = async ({ preview }: FetchOptions = {}): Promise<Teacher[]> => {
  return getTeachersCached(Boolean(preview));
};

const getTeachersCached = cache(async (preview: boolean): Promise<Teacher[]> => {
  const client = getClient({ preview });

  const query = groq`*[_type == "teacher"]{
    _id,
    name,
    subject,
    description,
    photo,
    badges,
    "hasSpots": hasSpots,
    services,
    trialLesson,
    reviews[] {
      _key,
      image,
      caption
    }
  }`;

  return safeSanityFetch(
    client,
    query,
    {},
    getSanityFetchOptions({ preview }, ['sanity:teacher']),
    [] as Teacher[],
  );
});

export async function getStats({ preview }: FetchOptions = {}): Promise<Stat[]> {
  return getStatsCached(Boolean(preview));
}

const getStatsCached = cache(async (preview: boolean): Promise<Stat[]> => {
  const client = getClient({ preview });
  return safeSanityFetch(
    client,
    groq`*[_type == "stat"]{
      _id,
      value,
      label,
      order
    } | order(coalesce(order, 9999) asc, _createdAt asc)`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:stat']),
    [] as Stat[],
  );
});

export async function getPrinciples({ preview }: FetchOptions = {}): Promise<Principle[]> {
  return getPrinciplesCached(Boolean(preview));
}

const getPrinciplesCached = cache(async (preview: boolean): Promise<Principle[]> => {
  const client = getClient({ preview });
  return safeSanityFetch(
    client,
    groq`*[_type == "principle"]{
      _id,
      title,
      description,
      order
    } | order(coalesce(order, 9999) asc, _createdAt asc)`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:principle']),
    [] as Principle[],
  );
});

export type MainPageReview = {
  _id: string;
  name: string;
  result: string;
  text: string;
};

export async function getMainPageReviews({ preview }: FetchOptions = {}): Promise<MainPageReview[]> {
  return getMainPageReviewsCached(Boolean(preview));
}

const getMainPageReviewsCached = cache(async (preview: boolean): Promise<MainPageReview[]> => {
  const client = getClient({ preview });
  return safeSanityFetch(
    client,
    groq`*[_type == "review"]{
      _id,
      name,
      result,
      text
    } | order(coalesce(order, 9999) asc, _createdAt asc)`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:review']),
    [] as MainPageReview[],
  );
});

export async function getProcessSteps({ preview }: FetchOptions = {}): Promise<ProcessStep[]> {
  return getProcessStepsCached(Boolean(preview));
}

const getProcessStepsCached = cache(async (preview: boolean): Promise<ProcessStep[]> => {
  const client = getClient({ preview });
  return safeSanityFetch(
    client,
    groq`*[_type == "processStep"]{
      _id,
      title,
      description
    } | order(coalesce(order, 9999) asc, _createdAt asc)`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:processStep']),
    [] as ProcessStep[],
  );
});

// Контент страницы курса (/): все блоки одним запросом.
// Любой блок может отсутствовать в Sanity — на клиенте подставляются дефолты.
export async function getMainPageContent({
  preview,
}: FetchOptions = {}): Promise<MainPageContent | null> {
  return getMainPageContentCached(Boolean(preview));
}

const getMainPageContentCached = cache(async (preview: boolean): Promise<MainPageContent | null> => {
  const client = getClient({ preview });
  return safeSanityFetch(
    client,
    groq`{
      "hero": *[_type == "courseHero"] | order(_updatedAt desc)[0]{
        eyebrow,
        headline,
        pills,
        questTitle,
        questNote,
        questPoints,
        buttonText
      },
      "mentor": *[_type == "mentorBlock"] | order(_updatedAt desc)[0]{
        sectionTitle,
        specs[]{ _key, label, value },
        journal[]{ _key, title, text },
        mentorName,
        mentorClass,
        mentorLevel,
        badges,
        quoteStatus,
        quoteText
      },
      "program": *[_type == "programBlock"] | order(_updatedAt desc)[0]{
        sectionTitle,
        missions[]{ _key, title, text }
      },
      "reviews": *[_type == "reviewsBlock"] | order(_updatedAt desc)[0]{
        sectionTitle
      },
      "init": *[_type == "initBlock"] | order(_updatedAt desc)[0]{
        sectionTitle,
        subtitle,
        steps[]{ _key, icon, title, lines },
        priceLabel,
        priceValue,
        pricePeriod,
        priceNote,
        buttonText
      },
      "faq": *[_type == "faqBlock"] | order(_updatedAt desc)[0]{
        sectionTitle
      },
      "faqItems": *[_type == "faqItem"] | order(coalesce(order, 9999) asc, _createdAt asc){
        question,
        answer
      },
      "paths": *[_type == "pathsBlock"] | order(_updatedAt desc)[0]{
        sectionTitle,
        columns[]{ _key, title, sub, description, perks },
        ctaText
      },
      "reviewItems": *[_type == "review"]{
        _id,
        name,
        result,
        text
      } | order(coalesce(order, 9999) asc, _createdAt asc)
    }`,
    {},
    getSanityFetchOptions({ preview }, [
      'sanity:courseHero',
      'sanity:mentorBlock',
      'sanity:programBlock',
      'sanity:reviewsBlock',
      'sanity:review',
      'sanity:initBlock',
      'sanity:faqBlock',
      'sanity:faqItem',
      'sanity:pathsBlock',
    ]),
    null,
  );
});
