import MainPageClient from './MainPageClient';
import { draftMode } from 'next/headers';
import { getMainPageReviews, getMainPageContent } from '@/lib/studio/sanityData';

export default async function MainPage() {
  const { isEnabled } = await draftMode();

  let reviews: Awaited<ReturnType<typeof getMainPageReviews>> = [];
  try {
    reviews = (await getMainPageReviews({ preview: isEnabled })) ?? [];
  } catch {
    reviews = [];
  }

  let content: Awaited<ReturnType<typeof getMainPageContent>> = null;
  try {
    content = await getMainPageContent({ preview: isEnabled });
  } catch {
    content = null;
  }

  return <MainPageClient reviews={reviews} content={content ?? undefined} />;
}
