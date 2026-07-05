import ReviewsSlider from '@/components/ui/ReviewsSlider';
import { Teacher } from '@/data/types';

interface TeacherReviewsBlockProps {
  teacher: Teacher;
}

export default function TeacherReviewsBlock({ teacher }: TeacherReviewsBlockProps) {
  const reviews = teacher.reviews || [];

  // Демо отзывы для локальной разработки
  const demoReviews = process.env.NODE_ENV === 'development' && !reviews.length ? [
    {
      _key: 'demo-1',
      image: 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=400&h=600&fit=crop',
      caption: 'Анна К.',
      teacherName: teacher.name
    },
    {
      _key: 'demo-2',
      image: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400&h=600&fit=crop',
      caption: 'Максим П.',
      teacherName: teacher.name
    }
  ] : [];

  const displayReviews = reviews.length > 0 ? reviews : demoReviews;

  if (!displayReviews.length) return null;

  return (
    <div className="teacher-reviews-block">
      <div className="teacher-reviews-header">
        <h3>Отзывы {teacher.name}</h3>
      </div>
      <ReviewsSlider reviews={displayReviews.map(r => ({ ...r, teacherName: teacher.name }))} />
    </div>
  );
}
