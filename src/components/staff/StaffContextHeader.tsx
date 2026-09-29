type Props = {
  area: 'regular' | 'work' | 'course';
  courseTitle?: string;
};

export default function StaffContextHeader({ area, courseTitle }: Props) {
  if (area === 'work') {
    return (
      <div className="staff-context-header">
        <span className="staff-context-kicker">Моя работа</span>
      </div>
    );
  }

  if (area === 'regular') {
    return (
      <div className="staff-context-header">
        <span className="staff-context-kicker">Обычные занятия</span>
      </div>
    );
  }

  return (
    <div className="staff-context-header">
      <span className="staff-context-kicker">Курс</span>
      {courseTitle ? <span className="staff-context-title">{courseTitle}</span> : null}
    </div>
  );
}
