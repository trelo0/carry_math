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

  const [
    contentResult,
    teachersResult,
    statsResult,
    principlesResult,
    processStepsResult,
    siteSettingsResult,
  ] = await Promise.allSettled([
    getIndividualPageContent({ preview: isEnabled }),
    getTeachers({ preview: isEnabled }),
    getStats({ preview: isEnabled }),
    getPrinciples({ preview: isEnabled }),
    getProcessSteps({ preview: isEnabled }),
    getSiteSettings({ preview: isEnabled }),
  ]);

  const content =
    contentResult.status === 'fulfilled' ? contentResult.value : null;

  const teachers =
    teachersResult.status === 'fulfilled' ? teachersResult.value : [];

  const stats =
    statsResult.status === 'fulfilled' ? statsResult.value : [];

  const principles =
    principlesResult.status === 'fulfilled'
      ? principlesResult.value
      : [];

  const processSteps =
    processStepsResult.status === 'fulfilled'
      ? processStepsResult.value
      : [];

  const siteSettings =
    siteSettingsResult.status === 'fulfilled'
      ? siteSettingsResult.value
      : null;

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