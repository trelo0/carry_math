'use client';

import { useRouter } from 'next/navigation';

/** Назад в кабинет: history.back если есть, иначе полный переход. */
export default function CabinetLessonBackLink() {
  const router = useRouter();

  return (
    <button
      type="button"
      className="cab-lespage-back"
      onClick={() => {
        if (typeof window !== 'undefined' && window.history.length > 1) {
          router.back();
          return;
        }
        router.push('/cabinet?section=course');
      }}
    >
      ← Кабинет курса
    </button>
  );
}
