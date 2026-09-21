'use client';

import { useState } from 'react';
import type { CuratorStudentView } from '@/lib/curator/students';
import { hwStatusLabel } from './curator-utils';

type RunAction = (action: () => Promise<string | void>, successText?: string) => Promise<void>;

export default function CuratorStudentsPanel({
  students,
  busy,
  runAction,
}: {
  students: CuratorStudentView[];
  busy: boolean;
  runAction: RunAction;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState('');
  const [messageTarget, setMessageTarget] = useState<number | null>(null);

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
                    {student.accessBlocked ? ' · доступ заблокирован' : ''}
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
                        void runAction(async () => {
                          const res = await fetch(
                            `/api/cabinet/curator/students/${student.telegramId}/restore-life`,
                            { method: 'POST' },
                          );
                          if (!res.ok) {
                            const body = (await res.json()) as { error?: string };
                            throw new Error(body.error ?? 'Не удалось восстановить');
                          }
                        }, 'Жизнь восстановлена')
                      }
                    >
                      +1 жизнь
                    </button>
                  </div>

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
                            void runAction(async () => {
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
                            }, 'Сообщение отправлено')
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
                    {visibleHomeworks.map((hw) => (
                      <li key={hw.sanityLessonId}>
                        <span>№{hw.number}</span>
                        <span>{hw.title}</span>
                        <span>{hwStatusLabel(hw.status)}</span>
                        {hw.status === 'waiting' ? (
                          <button
                            type="button"
                            className="curator-link-btn"
                            disabled={busy}
                            onClick={() =>
                              void runAction(async () => {
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
                              }, 'Жизнь снята')
                            }
                          >
                            Снять жизнь
                          </button>
                        ) : null}
                      </li>
                    ))}
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
