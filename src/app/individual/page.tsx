import HomePageClient from '../HomePageClient';
import { draftMode } from 'next/headers';
import {
  getIndividualPageContent,
  getPrinciples,
  getProcessSteps,
  getStats,
  getTeachers,
  getSiteSettings,
} from '@/lib/studio/sanityData';

export default async function IndividualPage() {
  const { isEnabled } = await draftMode();

  const [content, teachers, stats, principles, processSteps, siteSettings] = await Promise.all([
    getIndividualPageContent({ preview: isEnabled }).catch(() => null),
    getTeachers({ preview: isEnabled }),
    getStats({ preview: isEnabled }),
    getPrinciples({ preview: isEnabled }),
    getProcessSteps({ preview: isEnabled }),
    getSiteSettings({ preview: isEnabled }),
  ]);

  return (
    <HomePageClient
      content={content}
      teachers={teachers}
      stats={stats}
      principles={principles}
      processSteps={processSteps}
      siteSettings={siteSettings}
    />
  );
}
