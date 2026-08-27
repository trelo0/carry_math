// src/lib/studio/sanityData.ts
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
  const isDev = process.env.NODE_ENV !== 'production'
  const options: { cache: 'no-store' } | { next: { tags: string[]; revalidate: number } } = preview
    ? { cache: 'no-store' }
    : isDev
      ? { cache: 'no-store' }
      : {
          next: {
            tags,
            revalidate: 60,
          },
        }

  return options
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
  const client = getClient({ preview });
  return client.fetch(
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
    getSanityFetchOptions({ preview }, ['sanity:siteSettings'])
  );
}

// Контент страницы «Индивидуальные занятия» (/individual): все блоки одним запросом.
// Любой блок может отсутствовать в Sanity — на клиенте подставляются дефолты.
export async function getIndividualPageContent({
  preview,
}: FetchOptions = {}): Promise<IndividualPageContent | null> {
  const client = getClient({ preview });
  return client.fetch(
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
    ])
  );
}

export const getTeachers = async ({ preview }: FetchOptions = {}): Promise<Teacher[]> => {
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

  const teachers: Teacher[] = await client.fetch(
    query,
    {},
    getSanityFetchOptions({ preview }, ['sanity:teacher'])
  );
  return teachers;
};

export async function getStats({ preview }: FetchOptions = {}): Promise<Stat[]> {
  const client = getClient({ preview });
  return client.fetch(
    groq`*[_type == "stat"]{
      _id,
      value,
      label,
      order
    } | order(coalesce(order, 9999) asc, _createdAt asc)`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:stat'])
  );
}

export async function getPrinciples({ preview }: FetchOptions = {}): Promise<Principle[]> {
  const client = getClient({ preview });
  return client.fetch(
    groq`*[_type == "principle"]{
      _id,
      title,
      description,
      order
    } | order(coalesce(order, 9999) asc, _createdAt asc)`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:principle'])
  );
}

export type MainPageReview = {
  _id: string;
  name: string;
  result: string;
  text: string;
};

export async function getMainPageReviews({ preview }: FetchOptions = {}): Promise<MainPageReview[]> {
  const client = getClient({ preview });
  return client.fetch(
    groq`*[_type == "review"]{
      _id,
      name,
      result,
      text
    } | order(coalesce(order, 9999) asc, _createdAt asc)`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:review'])
  );
}

export async function getProcessSteps({ preview }: FetchOptions = {}): Promise<ProcessStep[]> {
  const client = getClient({ preview });
  return client.fetch(
    groq`*[_type == "processStep"]{
      _id,
      title,
      description
    } | order(coalesce(order, 9999) asc, _createdAt asc)`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:processStep'])
  );
}

// Контент страницы курса (/): все блоки одним запросом.
// Любой блок может отсутствовать в Sanity — на клиенте подставляются дефолты.
export async function getMainPageContent({
  preview,
}: FetchOptions = {}): Promise<MainPageContent | null> {
  const client = getClient({ preview });
  return client.fetch(
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
      }
    }`,
    {},
    getSanityFetchOptions({ preview }, [
      'sanity:courseHero',
      'sanity:mentorBlock',
      'sanity:programBlock',
      'sanity:reviewsBlock',
      'sanity:initBlock',
      'sanity:faqBlock',
      'sanity:faqItem',
      'sanity:pathsBlock',
    ])
  );
}
