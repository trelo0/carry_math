// src/lib/sanityData.ts
import { groq } from 'next-sanity';
import { Course, MethodStep, Problem, ProcessStep, Teacher, Review } from '@/data/types';
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
  privacyPolicyUrl?: string;
  headerButtonText?: string;
  heroButtonText?: string;
  teacherCardButtonText?: string;
};

export type HomePageContent = {
  heroTitle?: string;
  heroDescription?: string;
  signupTitle?: string;
  signupDescription?: string;
  sectionTeachersTitle?: string;
  sectionCoursesTitle?: string;
  sectionProblemsTitle?: string;
  sectionMethodTitle?: string;
  sectionProcessTitle?: string;
  sectionTeachersSubtitle?: string;
  sectionCoursesSubtitle?: string;
  sectionProblemsSubtitle?: string;
  sectionMethodSubtitle?: string;
  sectionProcessSubtitle?: string;
};

export async function getSiteSettings({ preview }: FetchOptions = {}): Promise<SiteSettings | null> {
  const client = getClient({ preview });
  return client.fetch(
    groq`*[_type == "siteSettings"] | order(_updatedAt desc)[0]{
      title,
      footerDescription,
      instagramUrl,
      privacyPolicyUrl,
      headerButtonText,
      heroButtonText,
      teacherCardButtonText
    }`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:siteSettings'])
  );
}

export async function getHomePage({ preview }: FetchOptions = {}): Promise<HomePageContent | null> {
  const client = getClient({ preview });
  return client.fetch(
    groq`*[_type == "homePage"] | order(_updatedAt desc)[0]{
      heroTitle,
      heroDescription,
      signupTitle,
      signupDescription,
      sectionTeachersTitle,
      sectionCoursesTitle,
      sectionProblemsTitle,
      sectionMethodTitle,
      sectionProcessTitle,
      sectionTeachersSubtitle,
      sectionCoursesSubtitle,
      sectionProblemsSubtitle,
      sectionMethodSubtitle,
      sectionProcessSubtitle
    }`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:homePage'])
  );
}

// Получить всех преподавателей
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

// Получить курсы
export async function getCourses({ preview }: FetchOptions = {}): Promise<Course[]> {
  const client = getClient({ preview });
  return client.fetch(
    groq`*[_type == "course"]{
      _id,
      icon,
      title,
      description,
      order
    } | order(coalesce(order, 9999) asc, _createdAt asc)`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:course'])
  );
}

// Получить шаги методики
export async function getMethodSteps({ preview }: FetchOptions = {}): Promise<MethodStep[]> {
  const client = getClient({ preview });
  return client.fetch(
    groq`*[_type == "methodStep"]{
      _id,
      title,
      description
    } | order(coalesce(order, 9999) asc, _createdAt asc)`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:methodStep'])
  );
}

// Получить шаги процесса
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

// Получить проблемы
export async function getProblems({ preview }: FetchOptions = {}): Promise<Problem[]> {
  const client = getClient({ preview });
  return client.fetch(
    groq`*[_type == "problem"]{
      _id,
      title,
      description
    } | order(coalesce(order, 9999) asc, _createdAt asc)`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:problem'])
  );
}

// Получить отзывы
export async function getReviews({ preview }: FetchOptions = {}): Promise<Review[]> {
  const client = getClient({ preview });
  return client.fetch(
    groq`*[_type == "review"]{
      _id,
      image,
      caption,
      teacherName
    } | order(_createdAt desc)`,
    {},
    getSanityFetchOptions({ preview }, ['sanity:review'])
  );
}