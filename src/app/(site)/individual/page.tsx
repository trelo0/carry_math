import HomePageClient from '../HomePageClient';

import { draftMode } from 'next/headers';

import { getIndividualPageBundle, getSiteSettings } from '@/lib/studio/sanityData';
import { withTeacherPhotoUrls } from '@/lib/studio/teacherPhotos';

export default async function IndividualPage() {
  const { isEnabled } = await draftMode();

  const [bundleResult, siteSettingsResult] = await Promise.allSettled([
    getIndividualPageBundle({ preview: isEnabled }),
    getSiteSettings({ preview: isEnabled }),
  ]);

  const bundle =
    bundleResult.status === 'fulfilled'
      ? bundleResult.value
      : {
          content: null,
          teachers: [],
          stats: [],
          principles: [],
          processSteps: [],
        };

  const siteSettings =
    siteSettingsResult.status === 'fulfilled'
      ? siteSettingsResult.value
      : null;

  return (
    <HomePageClient
      content={bundle.content}
      teachers={withTeacherPhotoUrls(bundle.teachers, { width: 560, height: 740 })}
      stats={bundle.stats}
      principles={bundle.principles}
      processSteps={bundle.processSteps}
      siteSettings={siteSettings}
    />
  );
}
