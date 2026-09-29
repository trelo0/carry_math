'use client';

import { useEffect, useState } from 'react';
import type { TeacherLessonView } from '@/lib/teacher/cabinet-data';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runWithKeyedFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';

type Props = {
  lesson: TeacherLessonView;
  busy: boolean;
  onClose: () => void;
  runAction: StaffRunAction;
};

export default function TeacherLessonRoom({ lesson, busy, onClose, runAction }: Props) {
  const [meetUrl, setMeetUrl] = useState(lesson.meetUrl ?? '');
  const [boardUrl, setBoardUrl] = useState(lesson.boardUrl ?? '');
  const [lessonPlan, setLessonPlan] = useState(lesson.lessonPlan ?? '');
  const [topic, setTopic] = useState(lesson.topic);
  const [feedbacks, setFeedbacks] = useState<Record<string, ActionFeedback>>({});

  useEffect(() => {
    setMeetUrl(lesson.meetUrl ?? '');
    setBoardUrl(lesson.boardUrl ?? '');
    setLessonPlan(lesson.lessonPlan ?? '');
    setTopic(lesson.topic);
  }, [lesson]);

  const participant =
    lesson.kind === 'group'
      ? lesson.groupTitle ?? 'Группа'
      : lesson.studentName ?? `Ученик ${lesson.studentTelegramId}`;

  const save = () => {
    void runWithKeyedFeedback(runAction, setFeedbacks, 'save', async () => {
      const res = await fetch(`/api/cabinet/teacher/lessons/${lesson.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetUrl: meetUrl.trim() || null,
          boardUrl: boardUrl.trim() || null,
          lessonPlan: lessonPlan.trim() || null,
          topic: topic.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось сохранить');
      }
    }, 'Кабинет занятия сохранён');
  };

  const cancelLesson = () => {
    if (!confirm(`Отменить занятие ${lesson.date} ${lesson.time}?`)) return;
    void runWithKeyedFeedback(runAction, setFeedbacks, 'cancel', async () => {
      const res = await fetch(`/api/cabinet/teacher/lessons/${lesson.id}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось отменить');
      }
      onClose();
    }, 'Занятие отменено');
  };

  return (
    <div className="teacher-lesson-room-overlay" role="dialog" aria-modal="true">
      <div className="teacher-lesson-room">
        <header className="teacher-lesson-room-head">
          <div>
            <p className="curator-muted">Кабинет занятия</p>
            <h2>
              {lesson.date} · {lesson.time}
            </h2>
            <p>
              <span className={`teacher-kind-badge kind-${lesson.kind}`}>
                {lesson.kind === 'group' ? 'Группа' : 'Индив.'}
              </span>{' '}
              {participant}
            </p>
          </div>
          <button type="button" className="curator-btn" onClick={onClose}>
            Закрыть
          </button>
        </header>

        <div className="teacher-lesson-room-grid">
          <label>
            Тема занятия
            <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </label>
          <label>
            Ссылка на урок
            <input
              type="url"
              value={meetUrl}
              onChange={(e) => setMeetUrl(e.target.value)}
              placeholder="https://..."
            />
          </label>
          <label>
            Ссылка на доску с материалами
            <input
              type="url"
              value={boardUrl}
              onChange={(e) => setBoardUrl(e.target.value)}
              placeholder="https://..."
            />
          </label>
          <label>
            План / что пройдём
            <textarea
              value={lessonPlan}
              onChange={(e) => setLessonPlan(e.target.value)}
              rows={4}
              placeholder="Темы, задания, материалы..."
            />
          </label>
        </div>

        <div className="teacher-student-card-actions">
          <button type="button" className="curator-btn curator-btn--primary" disabled={busy} onClick={save}>
            Сохранить
          </button>
          {meetUrl.trim() ? (
            <a href={meetUrl.trim()} className="curator-btn" target="_blank" rel="noopener noreferrer">
              Открыть урок
            </a>
          ) : null}
          {boardUrl.trim() ? (
            <a href={boardUrl.trim()} className="curator-btn" target="_blank" rel="noopener noreferrer">
              Открыть доску
            </a>
          ) : null}
          {lesson.isUpcoming ? (
            <button type="button" className="curator-link" disabled={busy} onClick={cancelLesson}>
              Отменить занятие
            </button>
          ) : null}
        </div>
        <CabinetFeedback feedback={feedbacks.save ?? feedbacks.cancel} />
      </div>
    </div>
  );
}
