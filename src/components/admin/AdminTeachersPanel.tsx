'use client';

import { IconCalendarRef } from '@/components/staff/schedule/ScheduleRefIcons';
import { initialsOf } from '@/lib/teacher/schedule-reference-utils';
import type { AdminTeacherRow } from '@/lib/admin/schedule-data';

type Props = {
  selfId: number;
  teachers: AdminTeacherRow[];
  activeId: number;
  loading: boolean;
  onPick: (telegramId: number) => void;
};

/** Блок «Преподаватели» в правой колонке расписания админа. */
export default function AdminTeachersPanel({ selfId, teachers, activeId, loading, onPick }: Props) {
  const selfActive = activeId === selfId;

  return (
    <section className="sr-card admin-teachers">
      <h2 className="sr-card-title sr-card-title--plain">Преподаватели ({teachers.length})</h2>

      <button
        type="button"
        className={`admin-teachers__self${selfActive ? ' is-active' : ''}`}
        onClick={() => onPick(selfId)}
        disabled={selfActive || loading}
        aria-pressed={selfActive}
      >
        <IconCalendarRef size={15} />
        <span>{selfActive ? 'Моё расписание' : 'Вернуться к своему расписанию'}</span>
      </button>

      {teachers.length === 0 ? (
        <p className="sr-muted">Других преподавателей нет</p>
      ) : (
        <ul className="sr-student-list admin-teachers__list">
          {teachers.map((t) => {
            const name = t.fullName?.trim() || `ID ${t.telegramId}`;
            const active = activeId === t.telegramId;
            return (
              <li key={t.telegramId}>
                <div className={`admin-teachers__row${active ? ' is-active' : ''}`}>
                  <span className={`sr-avatar sr-avatar--${t.telegramId % 4}`}>{initialsOf(name)}</span>
                  <span className="sr-student-text">
                    <strong>{name}</strong>
                    <span>
                      Сегодня {t.lessonsToday} · 7 дн. {t.lessonsWeek}
                      {t.nextLessonLabel ? ` · ${t.nextLessonLabel}` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={`sr-btn sr-btn--sm ${active ? 'sr-btn--primary' : 'sr-btn--ghost'}`}
                    onClick={() => onPick(t.telegramId)}
                    disabled={active || loading}
                    aria-pressed={active}
                  >
                    {active ? 'Открыто' : 'Расписание'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
