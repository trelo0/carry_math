'use client';

type Props = {
  open: boolean;
  courseTitle: string;
  studentName?: string | null;
  onClose: () => void;
};

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 4h8v6a4 4 0 0 1-8 0V4z M8 5H4.5a3 3 0 0 0 3.5 4 M16 5h3.5a3 3 0 0 1-3.5 4 M12 14v4 M8 21h8 M10 18h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function CourseCompleteModal({ open, courseTitle, studentName, onClose }: Props) {
  if (!open) return null;
  const greeting = studentName?.trim() ? `${studentName.trim()}, ` : '';

  return (
    <div className="cab-modal-backdrop cab-modal-backdrop--celebrate" role="presentation" onClick={onClose}>
      <div
        className="cab-modal cab-modal--enroll cab-modal--course-complete"
        role="dialog"
        aria-labelledby="course-complete-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="cab-modal-icon cab-modal-icon--gold" aria-hidden="true">
          <TrophyIcon />
        </span>
        <h3 id="course-complete-title">Курс пройден!</h3>
        <p className="cab-course-complete-lead">
          {greeting}ты дошёл до финиша по курсу «{courseTitle}». Молодец — это серьёзный результат.
        </p>
        <p className="cab-course-complete-note">
          Если ты внимательно проходил занятия и закреплял материал домашними заданиями, к централизованному
          тестированию ты подойдёшь увереннее. Дальше — повторение и практика, а мы рядом, если понадобится
          поддержка.
        </p>
        <div className="cab-modal-actions">
          <button type="button" className="cab-btn cab-btn--join" onClick={onClose}>
            К карте курса
          </button>
        </div>
      </div>
    </div>
  );
}
