'use client';

import { useMemo, useState } from 'react';
import type { TeacherStudentView, TeacherLessonView } from '@/lib/teacher/cabinet-data';
import { formatLessonDateTimeRu } from '@/lib/teacher/format';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runWithKeyedFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';

type Props = {
  student: TeacherStudentView;
  busy: boolean;
  onClose: () => void;
  onOpenLesson: (lesson: TeacherLessonView) => void;
  runAction: StaffRunAction;
  embedded?: boolean;
};

export default function TeacherStudentCard({
  student,
  busy,
  onClose,
  onOpenLesson,
  runAction,
  embedded = false,
}: Props) {
  const [rescheduleLesson, setRescheduleLesson] = useState<TeacherLessonView | null>(null);
  const [optionInputs, setOptionInputs] = useState(['', '', '']);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignKind, setAssignKind] = useState<'individual' | 'group'>('individual');
  const [assignStartsAt, setAssignStartsAt] = useState('');
  const [assignTopic, setAssignTopic] = useState('');
  const [notes, setNotes] = useState(student.notes);
  const [feedbacks, setFeedbacks] = useState<Record<string, ActionFeedback>>({});

  const tgUrl = `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME ?? 'district_math_bot'}?start=contact_${student.telegramId}`;

  const lessonDays = useMemo(() => {
    const days = new Map<string, number>();
    for (const lesson of student.lessons.filter((l) => l.status === 'scheduled')) {
      days.set(lesson.date, (days.get(lesson.date) ?? 0) + 1);
    }
    return [...days.entries()].sort((a, b) => {
      const [da, ma, ya] = a[0].split('.').map(Number);
      const [db, mb, yb] = b[0].split('.').map(Number);
      return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime();
    });
  }, [student.lessons]);

  const saveNotes = () => {
    void runWithKeyedFeedback(runAction, setFeedbacks, 'notes', async () => {
      const res = await fetch(`/api/cabinet/teacher/students/${student.telegramId}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось сохранить');
      }
    }, 'Заметки сохранены');
  };

  const submitReschedule = () => {
    if (!rescheduleLesson) return;
    const options = optionInputs
      .map((v) => v.trim())
      .filter(Boolean)
      .map((startsAt) => ({ startsAt: new Date(startsAt).toISOString() }));
    if (options.length === 0) {
      setFeedbacks((prev) => ({
        ...prev,
        reschedule: { type: 'error', message: 'Укажите хотя бы один вариант даты и времени' },
      }));
      return;
    }
    void runWithKeyedFeedback(runAction, setFeedbacks, 'reschedule', async () => {
      const res = await fetch('/api/cabinet/teacher/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonId: rescheduleLesson.id, options }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось отправить перенос');
      }
      setRescheduleLesson(null);
      setOptionInputs(['', '', '']);
    }, 'Варианты переноса отправлены ученику в Telegram');
  };

  const submitAssign = () => {
    if (!assignStartsAt) {
      setFeedbacks((prev) => ({
        ...prev,
        assign: { type: 'error', message: 'Укажите дату и время' },
      }));
      return;
    }
    void runWithKeyedFeedback(runAction, setFeedbacks, 'assign', async () => {
      const res = await fetch('/api/cabinet/teacher/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentTelegramId: student.telegramId,
          kind: assignKind,
          startsAt: new Date(assignStartsAt).toISOString(),
          topic: assignTopic.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось назначить');
      }
      setAssignOpen(false);
      setAssignStartsAt('');
      setAssignTopic('');
    }, 'Занятие назначено');
  };

  const upcoming = student.lessons.filter((l) => l.isUpcoming);

  return (
    <div className={`teacher-student-card${embedded ? ' teacher-student-card--embedded' : ''}`}>
      {!embedded ? (
        <header className="teacher-student-card-head">
          <div>
            <h2>{student.name ?? `Ученик ${student.telegramId}`}</h2>
            <p className="curator-muted">
              Индивидуальных: {student.individualCount} · Групповых: {student.groupCount}
            </p>
          </div>
          <button type="button" className="curator-btn" onClick={onClose}>
            Закрыть
          </button>
        </header>
      ) : null}

      <div className="teacher-student-card-actions">
        <a href={tgUrl} className="curator-btn curator-btn--primary" target="_blank" rel="noopener noreferrer">
          Написать в Telegram
        </a>
        <button type="button" className="curator-btn" onClick={() => setAssignOpen((v) => !v)}>
          Назначить занятие
        </button>
      </div>

      {lessonDays.length > 0 ? (
        <section className="curator-card">
          <h3>Дни занятий</h3>
          <ul className="teacher-lesson-days">
            {lessonDays.map(([date, count]) => (
              <li key={date}>
                <strong>{date}</strong>
                <span>
                  {count} {count === 1 ? 'занятие' : count < 5 ? 'занятия' : 'занятий'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="curator-card">
        <h3>Заметки</h3>
        <textarea
          className="teacher-notes-area"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Что планируете пройти, особенности ученика..."
        />
        <button type="button" className="curator-btn curator-btn--primary" disabled={busy} onClick={saveNotes}>
          Сохранить
        </button>
        <CabinetFeedback feedback={feedbacks.notes} />
      </section>

      {assignOpen ? (
        <section className="curator-card">
          <h3>Новое занятие</h3>
          <div className="teacher-form-row">
            <label>
              Тип
              <select value={assignKind} onChange={(e) => setAssignKind(e.target.value as 'individual' | 'group')}>
                <option value="individual">Индивидуальное</option>
                <option value="group">Групповое</option>
              </select>
            </label>
            <label>
              Дата и время
              <input type="datetime-local" value={assignStartsAt} onChange={(e) => setAssignStartsAt(e.target.value)} />
            </label>
            <label>
              Тема
              <input type="text" value={assignTopic} onChange={(e) => setAssignTopic(e.target.value)} placeholder="Тема занятия" />
            </label>
          </div>
          <button type="button" className="curator-btn curator-btn--primary" disabled={busy} onClick={submitAssign}>
            Сохранить
          </button>
          <CabinetFeedback feedback={feedbacks.assign} />
        </section>
      ) : null}

      <section className="curator-card">
        <h3>Предстоящие занятия</h3>
        {upcoming.length === 0 ? (
          <p className="curator-muted">Нет запланированных занятий.</p>
        ) : (
          <ul className="teacher-student-lessons">
            {upcoming.map((lesson) => (
              <li key={lesson.id} className={`kind-${lesson.kind}`}>
                <div>
                  <span className={`teacher-kind-badge kind-${lesson.kind}`}>
                    {lesson.kind === 'group' ? 'Группа' : 'Индив.'}
                  </span>
                  <strong>
                    {lesson.date} {lesson.time}
                  </strong>{' '}
                  — {lesson.topic}
                </div>
                <div className="teacher-timeline-actions">
                  <button type="button" className="curator-link" onClick={() => onOpenLesson(lesson)}>
                    Открыть
                  </button>
                  <button type="button" className="curator-link" disabled={busy} onClick={() => setRescheduleLesson(lesson)}>
                    Перенос
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {rescheduleLesson ? (
        <section className="curator-card">
          <h3>
            Перенос: {rescheduleLesson.date} {rescheduleLesson.time}
          </h3>
          <p className="curator-muted">Укажи 1–3 варианта — ученик выберет в Telegram.</p>
          {optionInputs.map((value, index) => (
            <label key={index} className="teacher-form-row">
              Вариант {index + 1}
              <input
                type="datetime-local"
                value={value}
                onChange={(e) => {
                  const next = [...optionInputs];
                  next[index] = e.target.value;
                  setOptionInputs(next);
                }}
              />
            </label>
          ))}
          <div className="teacher-student-card-actions">
            <button type="button" className="curator-btn curator-btn--primary" disabled={busy} onClick={submitReschedule}>
              Отправить ученику
            </button>
            <button type="button" className="curator-btn" onClick={() => setRescheduleLesson(null)}>
              Отмена
            </button>
          </div>
          <p className="curator-muted">Текущее время: {formatLessonDateTimeRu(rescheduleLesson.startsAt)}</p>
          <CabinetFeedback feedback={feedbacks.reschedule} />
        </section>
      ) : null}
    </div>
  );
}
