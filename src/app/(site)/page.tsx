import MainPageClient from './MainPageClient';
import { draftMode } from 'next/headers';
import { preload } from 'react-dom';
import { getMainPageContent } from '@/lib/studio/sanityData';

export default async function MainPage() {
  preload('/teachers/lidia2.webp', { as: 'image', fetchPriority: 'high' });
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
