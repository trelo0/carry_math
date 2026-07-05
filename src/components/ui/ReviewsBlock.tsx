import ReviewsSlider from '@/components/ui/ReviewsSlider';
import { Teacher } from '@/data/types';

interface ReviewsBlockProps {
  teachers: Teacher[];
  title?: string;
}

export default function ReviewsBlock({ teachers, title = 'Отзывы' }: ReviewsBlockProps) {
  // Собираем все отзывы с именем преподавателя
  const items = teachers.flatMap((t) =>
    (t.reviews || []).map((r) => ({
      ...r,
      teacherName: t.name
    }))
  );

  // Демо отзывы для локальной разработки
  const demoItems = process.env.NODE_ENV === 'development' && !items.length ? [
    {
      _key: 'demo-1',
      image: 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=400&h=600&fit=crop',
      caption: 'Анна К.',
      teacherName: 'Преподаватель'
    },
    {
      _key: 'demo-2',
      image: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400&h=600&fit=crop',
      caption: 'Максим П.',
      teacherName: 'Преподаватель'
    },
    {
      _key: 'demo-3',
      image: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400&h=600&fit=crop',
      caption: 'Елена С.',
      teacherName: 'Преподаватель'
    }
  ] : [];

  const displayItems = items.length > 0 ? items : demoItems;

  if (!displayItems.length) return null;

  return (
    <section className="section reviews-wrapper" id="reviews">
      <div className="container">
        <div className="section-title">
          <h2>{title}</h2>
          <p>Они просто скрины, но зато настоящие 🙂</p>
        </div>
        <ReviewsSlider reviews={displayItems} />
      </div>
    </section>
  );
}
