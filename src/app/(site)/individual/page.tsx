import HomePageClient from '../HomePageClient';

import { draftMode } from 'next/headers';

import { getIndividualPageBundle, getSiteSettings } from '@/lib/studio/sanityData';
import { withTeacherPhotoUrls } from '@/lib/studio/teacherPhotos';
import { getCabinetPricing } from '@/lib/studio/cabinetSettings';
import { matchCabinetTeacherId } from '@/lib/lead-apply-link';

export default async function IndividualPage() {
  const { isEnabled } = await draftMode();

  const [bundleResult, siteSettingsResult, pricingResult] = await Promise.allSettled([
    getIndividualPageBundle({ preview: isEnabled }),
    getSiteSettings({ preview: isEnabled }),
    getCabinetPricing(),
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

  const cabinetTeachers =
    pricingResult.status === 'fulfilled' ? pricingResult.value.teachers : [];
  const teachersWithPhotos = withTeacherPhotoUrls(bundle.teachers, { width: 560, height: 740 });
  const teacherLeadIds: Record<string, string> = {};
  for (const teacher of teachersWithPhotos) {
    const id = matchCabinetTeacherId(teacher.name, cabinetTeachers);
    if (id) teacherLeadIds[teacher._id] = id;
  }

  return (
    <HomePageClient
      content={bundle.content}
      teachers={teachersWithPhotos}
      teacherLeadIds={teacherLeadIds}
      stats={bundle.stats}
      principles={bundle.principles}
      processSteps={bundle.processSteps}
      siteSettings={siteSettings}
    />
  );
}
