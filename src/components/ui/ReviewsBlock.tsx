import ReviewsSlider from '@/components/ui/ReviewsSlider';
import { Teacher } from '@/data/types';

interface ReviewsBlockProps {
  teachers: Teacher[];
  title?: string;
}

export default function ReviewsBlock({ teachers, title = 'Отзывы' }: ReviewsBlockProps) {
  // Собираем все отзывы с именем преподавателя
  const items = teachers.flatMap((t) =>
    (t.reviews || []).map((r) => ({ ...r, teacherName: t.name }))
  );

  if (!items.length) return null;

  return (
    <section className="section reviews-wrapper" id="reviews">
      <div className="container">
        <div className="section-title">
          <h2>{title}</h2>
          <p>Они просто скрины, но зато настоящие 🙂</p>
        </div>
        <ReviewsSlider reviews={items} />
      </div>
    </section>
  );
}
