import ReviewsSlider from '@/components/ui/ReviewsSlider';
import { Review } from '@/data/types';

interface ReviewsBlockProps {
  reviews: Review[];
  title?: string;
}

export default function ReviewsBlock({ reviews, title = 'Отзывы' }: ReviewsBlockProps) {
  if (!reviews.length) return null;

  return (
    <section className="section reviews-wrapper" id="reviews">
      <div className="container">
        <div className="section-title">
          <h2>{title}</h2>
          <p>Они просто скрины, но зато настоящие 🙂</p>
        </div>
        <ReviewsSlider reviews={reviews} />
      </div>
    </section>
  );
}
