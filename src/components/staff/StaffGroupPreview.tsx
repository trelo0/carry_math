'use client';

import type { TeacherGroupView } from '@/lib/teacher/cabinet-data';
import {
  formatGroupLessonDate,
  formatGroupLessonTimeRange,
  getGroupNextLesson,
  membersCountLabel,
} from './staff-directory-utils';

type Props = {
  group: TeacherGroupView;
  onOpenGroup: () => void;
};

export default function StaffGroupPreview({ group, onOpenGroup }: Props) {
  const nextLesson = getGroupNextLesson(group);
  const visibleMembers = group.members.slice(0, 3);
  const hiddenCount = Math.max(0, group.members.length - visibleMembers.length);

  return (
    <aside className="staff-directory-aside sched-aside-block">
      <div className="staff-directory-aside-head">
        <h2 className="staff-directory-aside-name">{group.title}</h2>
        <p className="staff-directory-aside-sub">{nextLesson?.topic?.trim() || 'Групповые занятия'}</p>
        <p className="staff-directory-meta">{membersCountLabel(group.members.length)}</p>
      </div>

      <section className="staff-directory-section">
        <h3 className="sched-aside-label">Ближайшее занятие</h3>
        {nextLesson ? (
          <>
            <p className="staff-directory-stat">{formatGroupLessonDate(nextLesson.startsAt)}</p>
            <p className="staff-directory-meta">{formatGroupLessonTimeRange(nextLesson)}</p>
          </>
        ) : (
          <p className="staff-directory-meta staff-directory-meta--muted">Не запланировано</p>
        )}
      </section>

      <section className="staff-directory-section">
        <h3 className="sched-aside-label">Ученики · {group.members.length}</h3>
        {group.members.length === 0 ? (
          <p className="staff-directory-meta staff-directory-meta--muted">Пока нет учеников</p>
        ) : (
          <ul className="staff-directory-members">
            {visibleMembers.map((member) => (
              <li key={member.telegramId}>{member.name ?? `ID ${member.telegramId}`}</li>
            ))}
            {hiddenCount > 0 ? <li className="staff-directory-members-more">+ ещё {hiddenCount}</li> : null}
          </ul>
        )}
      </section>

      <button type="button" className="sched-btn sched-btn--primary staff-directory-open-btn" onClick={onOpenGroup}>
        Открыть группу
      </button>
    </aside>
  );
}
