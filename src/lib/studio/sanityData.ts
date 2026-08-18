// src/lib/studio/sanityData.ts
import { groq } from 'next-sanity';
import { Principle, ProcessStep, Stat, Teacher } from '@/data/types';
import { getSanityClient } from './sanityClient';

type FetchOptions = {
  preview?: boolean;
};

function getClient({ preview }: FetchOptions = {}) {
  return getSanityClient({ preview });
}

function getSanityFetchOptions({ preview }: FetchOptions, tags: string[]) {
  const isDev = process.env.NODE_ENV !== 'production'
  const options: any = preview
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

export type HomePageContent = {
  heroEyebrow?: string;
  heroTitle?: string;
  heroDescription?: string;
  sectionTeachersTitle?: string;
  sectionTeachersSubtitle?: string;
  sectionPrinciplesTitle?: string;
  sectionPrinciplesSubtitle?: string;
  sectionProcessTitle?: string;
  sectionProcessSubtitle?: string;
  diagnosticEyebrow?: string;
  diagnosticTitle?: string;
  diagnosticText?: string;
  diagnosticButtonText?: string;
  diagnosticSteps?: { _key: string; title: string; text: string }[];
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

export async function getHomePage({ preview }: FetchOptions = {}): Promise<HomePageContent | null> {
  const client = getClient({ preview });
  return client.fetch(
    groq`*[_type == "homePage"] | order(_updatedAt desc)[0]{
      heroEyebrow,
      heroTitle,
      heroDescription,
      sectionTeachersTitle,
      sectionTeachersSubtitle,
      sectionPrinciplesTitle,
      sectionPrinciplesSubtitle,
      sectionProcessTitle,
      sectionProcessSubtitle,
      diagnosticEyebrow,
      diagnosticTitle,
      diagnosticText,
      diagnosticButtonText,
      diagnosticSteps[]{ _key, title, text }
    }`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:homePage'])
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
