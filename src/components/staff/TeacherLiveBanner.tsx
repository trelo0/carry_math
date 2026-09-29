'use client';

import type { TeacherLessonView } from '@/lib/teacher/cabinet-data';

type Props = {
  lesson: TeacherLessonView;
  onOpen: () => void;
};

export default function TeacherLiveBanner({ lesson, onOpen }: Props) {
  const label =
    lesson.kind === 'group'
      ? lesson.groupTitle ?? 'Групповое занятие'
      : lesson.studentName ?? `Ученик ${lesson.studentTelegramId}`;

  return (
    <div className="teacher-live-banner">
      <div className="teacher-live-banner-text">
        <span className="teacher-live-dot" aria-hidden="true" />
        <strong>Сейчас занятие</strong>
        <span>
          {lesson.time} · {label} · {lesson.topic}
        </span>
      </div>
      <button type="button" className="curator-btn curator-btn--primary" onClick={onOpen}>
        Открыть кабинет
      </button>
    </div>
  );
}
