'use client';

import { useEffect, useState } from 'react';
import type { CuratorStudentView } from '@/lib/curator/students';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runWithKeyedFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';
import { hwStatusLabel } from './curator-utils';

type LifeEventRow = {
  id: number;
  delta: number;
  reason: string;
  livesBefore: number | null;
  livesAfter: number | null;
  createdAt: string;
};

export default function CuratorStudentsPanel({
  students,
  busy,
  runAction,
}: {
  students: CuratorStudentView[];
  busy: boolean;
  runAction: StaffRunAction;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState('');
  const [messageTarget, setMessageTarget] = useState<number | null>(null);
  const [feedbacks, setFeedbacks] = useState<Record<string, ActionFeedback>>({});
  const [lifeEvents, setLifeEvents] = useState<Record<string, LifeEventRow[]>>({});
  const [lifeEventsTick, setLifeEventsTick] = useState(0);

  useEffect(() => {
    if (!expandedId) return;
    const student = students.find((s) => s.id === expandedId);
    if (!student) return;
    let cancelled = false;
    void fetch(`/api/cabinet/curator/students/${student.telegramId}/life-events`)
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { events?: LifeEventRow[] };
        setLifeEvents((prev) => ({ ...prev, [expandedId]: body.events ?? [] }));
      })
      .catch(() => {
        if (!cancelled) setLifeEvents((prev) => ({ ...prev, [expandedId]: [] }));
      });
    return () => {
      cancelled = true;
    };
  }, [expandedId, students, lifeEventsTick]);

  if (students.length === 0) {
    return (
      <div className="curator-panel">
        <h1 className="curator-title">Ученики</h1>
        <p className="curator-muted">Пока нет учеников с оплаченным доступом к курсу.</p>
      </div>
    );
  }

  return (
    <div className="curator-panel curator-panel--wide">
      <header className="curator-page-head">
        <div>
          <h1 className="curator-title">Ученики курса</h1>
          <p className="curator-muted">{students.length} человек с активным доступом</p>
        </div>
      </header>

      <ul className="curator-student-list">
        {students.map((student) => {
          const expanded = expandedId === student.id;
          const reviewCount = student.homeworks.filter((hw) => hw.status === 'submitted').length;
          const debtCount = student.homeworks.filter((hw) => hw.status === 'waiting').length;
          const visibleHomeworks = student.homeworks.filter((hw) => hw.status !== 'upcoming');
          const lifeKey = `${student.id}-life`;
          const messageKey = `${student.id}-message`;

          return (
            <li key={student.id} className={`curator-student-card${expanded ? ' is-open' : ''}`}>
              <button
                type="button"
                className="curator-student-summary"
                onClick={() => setExpandedId(expanded ? null : student.id)}
              >
                <div className="curator-student-main">
                  <strong>{student.name}</strong>
                  <p className="curator-muted">
                    {student.phone ?? `ID ${student.telegramId}`}
                    {student.fullyBlocked
                      ? ' · полная блокировка'
                      : student.accessBlocked
                        ? ' · новые занятия закрыты'
                        : ''}
                  </p>
                </div>
                <div className="curator-student-metrics">
                  <span>{student.progressPercent}%</span>
                  <span>❤️ {student.livesCurrent ?? '—'}/{student.livesMax ?? '—'}</span>
                  <span>
                    ДЗ
                    {reviewCount > 0 ? ` · ${reviewCount} на проверке` : ''}
                    {debtCount > 0 ? ` · ${debtCount} не сдано` : reviewCount === 0 ? ' · всё сдано' : ''}
                  </span>
                </div>
              </button>

              {expanded ? (
                <div className="curator-student-body">
                  <div className="curator-student-actions">
                    <button
                      type="button"
                      className="curator-btn curator-btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        setMessageTarget(student.telegramId);
                        setMessageDraft('');
                      }}
                    >
                      Написать в Telegram
                    </button>
                    <button
                      type="button"
                      className="curator-btn curator-btn-ghost"
                      disabled={busy || (student.livesCurrent ?? 0) >= (student.livesMax ?? 3)}
                      onClick={() =>
                        void runWithKeyedFeedback(
                          runAction,
                          setFeedbacks,
                          lifeKey,
                          async () => {
                            const res = await fetch(
                              `/api/cabinet/curator/students/${student.telegramId}/restore-life`,
                              { method: 'POST' },
                            );
                            if (!res.ok) {
                              const body = (await res.json()) as { error?: string };
                              throw new Error(body.error ?? 'Не удалось восстановить');
                            }
                            setLifeEventsTick((n) => n + 1);
                          },
                          'Жизнь восстановлена',
                        )
                      }
                    >
                      +1 жизнь
                    </button>
                    {student.accessBlocked ? (
                      <button
                        type="button"
                        className="curator-btn curator-btn-ghost"
                        disabled={busy}
                        onClick={() =>
                          void runWithKeyedFeedback(
                            runAction,
                            setFeedbacks,
                            `${student.id}-unfreeze`,
                            async () => {
                              const res = await fetch(
                                `/api/cabinet/curator/students/${student.telegramId}/unfreeze`,
                                { method: 'POST' },
                              );
                              if (!res.ok) {
                                const body = (await res.json()) as { error?: string };
                                throw new Error(body.error ?? 'Не удалось разморозить');
                              }
                            },
                            'Курс разморожен',
                          )
                        }
                      >
                        Разморозить курс
                      </button>
                    ) : null}
                  </div>
                  <CabinetFeedback feedback={feedbacks[lifeKey]} />

                  {lifeEvents[student.id]?.length ? (
                    <div className="curator-life-history">
                      <h3>История жизней</h3>
                      <ul>
                        {lifeEvents[student.id]!.slice(0, 8).map((ev) => (
                          <li key={ev.id}>
                            <span>
                              {ev.delta > 0 ? `+${ev.delta}` : ev.delta} · {ev.reason}
                            </span>
                            <span className="curator-muted">
                              {ev.livesBefore != null && ev.livesAfter != null
                                ? `${ev.livesBefore}→${ev.livesAfter}`
                                : ''}{' '}
                              {new Date(ev.createdAt).toLocaleString('ru-RU', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {messageTarget === student.telegramId ? (
                    <div className="curator-message-box">
                      <textarea
                        rows={3}
                        value={messageDraft}
                        onChange={(e) => setMessageDraft(e.target.value)}
                        placeholder="Сообщение от куратора (отправится через бота)"
                      />
                      <div className="curator-btn-row">
                        <button
                          type="button"
                          className="curator-btn"
                          disabled={busy || !messageDraft.trim()}
                          onClick={() =>
                            void runWithKeyedFeedback(
                              runAction,
                              setFeedbacks,
                              messageKey,
                              async () => {
                                const res = await fetch(
                                  `/api/cabinet/curator/students/${student.telegramId}/message`,
                                  {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ text: messageDraft.trim() }),
                                  },
                                );
                                if (!res.ok) {
                                  const body = (await res.json()) as { error?: string };
                                  throw new Error(body.error ?? 'Не удалось отправить');
                                }
                                setMessageTarget(null);
                                setMessageDraft('');
                              },
                              'Сообщение отправлено',
                            )
                          }
                        >
                          Отправить
                        </button>
                        <button
                          type="button"
                          className="curator-link-btn"
                          onClick={() => setMessageTarget(null)}
                        >
                          Отмена
                        </button>
                      </div>
                      <CabinetFeedback feedback={feedbacks[messageKey]} />
                    </div>
                  ) : null}

                  <div className="curator-progress-bar" aria-hidden="true">
                    <i style={{ width: `${student.progressPercent}%` }} />
                  </div>
                  <p className="curator-muted">
                    Пройдено {student.completedLessons} из {student.totalLessons} занятий
                  </p>

                  <h3>Домашние задания</h3>
                  {visibleHomeworks.length === 0 ? (
                    <p className="curator-muted">Пока нет доступных домашних заданий — они появятся после завершения эфиров.</p>
                  ) : null}
                  <ul className="curator-hw-table">
                    {visibleHomeworks.map((hw) => {
                      const hwKey = `${student.id}-hw-${hw.sanityLessonId}`;
                      return (
                        <li key={hw.sanityLessonId}>
                          <span>№{hw.number}</span>
                          <span>{hw.title}</span>
                          <span>{hwStatusLabel(hw.status)}</span>
                          {hw.status === 'waiting' ? (
                            <span className="curator-hw-action">
                              <button
                                type="button"
                                className="curator-link-btn"
                                disabled={busy}
                                onClick={() =>
                                  void runWithKeyedFeedback(
                                    runAction,
                                    setFeedbacks,
                                    hwKey,
                                    async () => {
                                      const res = await fetch(
                                        `/api/cabinet/curator/students/${student.telegramId}/deduct-life`,
                                        {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ sanityLessonId: hw.sanityLessonId }),
                                        },
                                      );
                                      if (!res.ok) {
                                        const body = (await res.json()) as { error?: string };
                                        throw new Error(body.error ?? 'Не удалось снять жизнь');
                                      }
                                      setLifeEventsTick((n) => n + 1);
                                    },
                                    'Жизнь снята',
                                  )
                                }
                              >
                                Снять жизнь
                              </button>
                              <CabinetFeedback feedback={feedbacks[hwKey]} />
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
