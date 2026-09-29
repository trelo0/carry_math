import MainPageClient from './MainPageClient';
import { draftMode } from 'next/headers';
import { getMainPageContent } from '@/lib/studio/sanityData';

export default async function MainPage() {
  const { isEnabled } = await draftMode();

  let content: Awaited<ReturnType<typeof getMainPageContent>> = null;
  try {
    content = await getMainPageContent({ preview: isEnabled });
  } catch {
    content = null;
  }

  return (
    <MainPageClient
      reviews={content?.reviewItems}
      content={content ?? undefined}
    />
  );
}
