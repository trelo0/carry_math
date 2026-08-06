import HomePageClient from './HomePageClient';
import { draftMode } from 'next/headers';
import {
  getHomePage,
  getPrinciples,
  getProcessSteps,
  getStats,
  getTeachers,
  getSiteSettings,
} from '@/lib/sanity';

export default async function HomePage() {
  const { isEnabled } = await draftMode();

  const [home, teachers, stats, principles, processSteps, siteSettings] = await Promise.all([
    getHomePage({ preview: isEnabled }),
    getTeachers({ preview: isEnabled }),
    getStats({ preview: isEnabled }),
    getPrinciples({ preview: isEnabled }),
    getProcessSteps({ preview: isEnabled }),
    getSiteSettings({ preview: isEnabled }),
  ]);

  if (!home) {
    throw new Error(
      'Missing Sanity document: homePage. Create and publish the "Главная страница" document in Sanity Studio.',
    );
  }

  return (
    <HomePageClient
      home={home}
      teachers={teachers}
      stats={stats}
      principles={principles}
      processSteps={processSteps}
      siteSettings={siteSettings}
    />
  );
}
