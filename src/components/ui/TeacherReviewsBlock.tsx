import ReviewsSlider from '@/components/ui/ReviewsSlider';
import { Teacher } from '@/data/types';

interface TeacherReviewsBlockProps {
  teacher: Teacher;
}

export default function TeacherReviewsBlock({ teacher }: TeacherReviewsBlockProps) {
  const reviews = teacher.reviews || [];

  if (!reviews.length) return null;

  return (
    <div className="teacher-reviews-block">
      <ReviewsSlider
        reviews={reviews.map((review) => ({ ...review, teacherName: teacher.name }))}
        variant="under-teacher"
      />
    </div>
  );
}
