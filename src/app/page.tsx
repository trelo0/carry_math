import HomePageClient from './HomePageClient';
import { draftMode } from 'next/headers';
import {
  getCourses,
  getHomePage,
  getMethodSteps,
  getProblems,
  getProcessSteps,
  getTeachers,
  getSiteSettings,
  getReviews,
} from '@/lib/sanity';

export default async function HomePage() {
  const { isEnabled } = await draftMode();

  const [home, courses, teachers, methodSteps, processSteps, problems, siteSettings, reviews] = await Promise.all([
    getHomePage({ preview: isEnabled }),
    getCourses({ preview: isEnabled }),
    getTeachers({ preview: isEnabled }),
    getMethodSteps({ preview: isEnabled }),
    getProcessSteps({ preview: isEnabled }),
    getProblems({ preview: isEnabled }),
    getSiteSettings({ preview: isEnabled }),
    getReviews({ preview: isEnabled }),
  ]);

  if (!home) {
    throw new Error(
      'Missing Sanity document: homePage. Create and publish the "Главная страница" document in Sanity Studio.',
    );
  }

  return (
    <HomePageClient
      home={home}
      courses={courses}
      teachers={teachers}
      methodSteps={methodSteps}
      processSteps={processSteps}
      problems={problems}
      siteSettings={siteSettings}
      reviews={reviews}
    />
  );
}
