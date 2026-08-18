import MainPageClient from './MainPageClient';
import { getMainPageReviews } from '@/lib/studio/sanityData';

export default async function MainPage() {
  let reviews: Awaited<ReturnType<typeof getMainPageReviews>> = [];
  try {
    reviews = (await getMainPageReviews()) ?? [];
  } catch {
    reviews = [];
  }
  return <MainPageClient reviews={reviews} />;
}
