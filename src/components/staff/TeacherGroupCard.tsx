'use client';

import { useState } from 'react';
import type { TeacherGroupDetailView } from '@/lib/teacher/group-detail';
import type { TeacherLessonView } from '@/lib/teacher/cabinet-data';
import { statusLabel } from '@/lib/teacher/schedule-utils';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runWithFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';

type Props = {
  group: TeacherGroupDetailView;
  busy: boolean;
  onClose: () => void;
  onOpenStudent: (telegramId: number) => void;
  onOpenLesson: (lesson: TeacherLessonView) => void;
  onOpenSchedule?: () => void;
  runAction: StaffRunAction;
};

function formatLessonWhen(iso: string): string {
  const formatted = new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
  return formatted.replace(',', ' ·');
}

export default function TeacherGroupCard({
  group,
  busy,
  onClose,
  onOpenStudent,
  onOpenLesson,
  onOpenSchedule,
  runAction,
}: Props) {
  const [notes, setNotes] = useState(group.notes);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  const saveNotes = () => {
    void runWithFeedback(runAction, setFeedback, async () => {
      const res = await fetch(`/api/cabinet/teacher/groups/${group.id}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось сохранить');
      }
    }, 'Заметки по группе сохранены');
  };

  return (
    <div className="teacher-student-card staff-group-detail">
      <header className="teacher-student-card-head">
        <div>
          <span className="schedule-side-kind schedule-side-kind--group">Группа</span>
          <h2>{group.title}</h2>
          <p className="curator-muted">
            {group.members.length}{' '}
            {group.members.length === 1
              ? 'ученик'
              : group.members.length < 5
                ? 'ученика'
                : 'учеников'}
          </p>
        </div>
        <button type="button" className="curator-btn" onClick={onClose}>
          Закрыть
        </button>
      </header>

      {group.nextLesson ? (
        <section className="schedule-detail-section">
          <h3 className="schedule-detail-label">Следующее занятие</h3>
          <p className="schedule-detail-primary">{formatLessonWhen(group.nextLesson.startsAt)}</p>
          <p className="curator-muted">{group.nextLesson.topic}</p>
          <div className="teacher-student-card-actions">
            <button type="button" className="curator-btn" onClick={() => onOpenLesson(group.nextLesson!)}>
              Открыть занятие
            </button>
            {onOpenSchedule ? (
              <button type="button" className="curator-btn curator-btn-ghost" onClick={onOpenSchedule}>
                Открыть в расписании
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="schedule-detail-section">
          <h3 className="schedule-detail-label">Следующее занятие</h3>
          <p className="curator-muted">Не запланировано</p>
        </section>
      )}

      <section className="curator-card">
        <h3>Ученики</h3>
        {group.members.length === 0 ? (
          <p className="curator-muted">В группе пока нет учеников.</p>
        ) : (
          <ul className="staff-student-hw-list">
            {group.members.map((member) => (
              <li key={member.telegramId}>
                <button type="button" className="curator-link" onClick={() => onOpenStudent(member.telegramId)}>
                  {member.name ?? `ID ${member.telegramId}`}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {group.recentLessons.length > 0 ? (
        <section className="curator-card">
          <h3>Последние занятия</h3>
          <ul className="teacher-student-lessons">
            {group.recentLessons.map((lesson) => (
              <li key={`${lesson.id}-${lesson.startsAt}`} className="kind-group">
                <div>
                  <strong>{formatLessonWhen(lesson.startsAt)}</strong>
                  <span className="curator-muted"> · {statusLabel(lesson.status)}</span>
                  {lesson.topic ? <span> — {lesson.topic}</span> : null}
                </div>
                <button type="button" className="curator-link" onClick={() => onOpenLesson(lesson)}>
                  Открыть
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="curator-card">
        <h3>Заметки по группе</h3>
        <textarea
          className="teacher-notes-area"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="План занятий, материалы, особенности группы..."
        />
        <button type="button" className="curator-btn curator-btn--primary" disabled={busy} onClick={saveNotes}>
          Сохранить
        </button>
        <CabinetFeedback feedback={feedback} />
      </section>
    </div>
  );
}
