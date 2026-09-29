'use client';

import { useMemo, useState } from 'react';
import type { CuratorHomeworkBoardItem } from '@/lib/curator/students';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runWithKeyedFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';
import { hwStatusLabel } from './curator-utils';

function itemKey(item: CuratorHomeworkBoardItem): string {
  return `${item.studentId}-${item.sanityLessonId}`;
}

export default function CuratorHomeworkPanel({
  board,
  busy,
  runAction,
  rejectTarget,
  rejectNote,
  onRejectNote,
  onRejectTarget,
}: {
  board: CuratorHomeworkBoardItem[];
  busy: boolean;
  runAction: StaffRunAction;
  rejectTarget: CuratorHomeworkBoardItem | null;
  rejectNote: string;
  onRejectNote: (v: string) => void;
  onRejectTarget: (item: CuratorHomeworkBoardItem | null) => void;
}) {
  const [view, setView] = useState<'queue' | 'all'>('queue');
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [feedbacks, setFeedbacks] = useState<Record<string, ActionFeedback>>({});

  const modules = useMemo(
    () => [...new Set(board.map((item) => item.moduleTitle))],
    [board],
  );

  const items = board.filter((item) => {
    if (view === 'queue' && item.status !== 'submitted') return false;
    if (moduleFilter !== 'all' && item.moduleTitle !== moduleFilter) return false;
    return true;
  });

  const approve = (item: CuratorHomeworkBoardItem) => {
    void runWithKeyedFeedback(
      runAction,
      setFeedbacks,
      itemKey(item),
      async () => {
        const res = await fetch('/api/cabinet/curator/homework/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentTelegramId: item.studentTelegramId,
            lessonNumber: item.number,
          }),
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? 'Не удалось принять');
        }
      },
      'Домашка принята',
    );
  };

  const reject = (item: CuratorHomeworkBoardItem) => {
    void runWithKeyedFeedback(
      runAction,
      setFeedbacks,
      itemKey(item),
      async () => {
        const res = await fetch('/api/cabinet/curator/homework/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentTelegramId: item.studentTelegramId,
            lessonNumber: item.number,
            note: rejectNote.trim() || undefined,
          }),
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? 'Не удалось отклонить');
        }
        onRejectTarget(null);
        onRejectNote('');
      },
      'Домашка отправлена на доработку',
    );
  };

  return (
    <div className="curator-panel curator-panel--wide">
      <header className="curator-page-head">
        <div>
          <h1 className="curator-title">Домашние задания</h1>
          <p className="curator-muted">
            Отправки из Telegram сохраняются в базе и отображаются здесь
          </p>
        </div>
      </header>

      <div className="curator-filter-row">
        <button
          type="button"
          className={`curator-filter-chip${view === 'queue' ? ' is-active' : ''}`}
          onClick={() => setView('queue')}
        >
          На проверке
        </button>
        <button
          type="button"
          className={`curator-filter-chip${view === 'all' ? ' is-active' : ''}`}
          onClick={() => setView('all')}
        >
          Все с ответами
        </button>
        {modules.map((mod) => (
          <button
            key={mod}
            type="button"
            className={`curator-filter-chip${moduleFilter === mod ? ' is-active' : ''}`}
            onClick={() => setModuleFilter(mod)}
          >
            {mod}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="curator-muted">Нет домашних заданий в этой выборке.</p>
      ) : (
        <ul className="curator-hw-board">
          {items.map((item) => {
            const key = itemKey(item);
            return (
              <li key={key} className="curator-card">
                <div className="curator-hw-board-head">
                  <div>
                    <p className="curator-kicker">{item.moduleTitle}</p>
                    <h2>{item.studentName}</h2>
                    <p>
                      Занятие №{item.number}: {item.title}
                    </p>
                  </div>
                  <span className="curator-pill">{hwStatusLabel(item.status)}</span>
                </div>

                {item.submissionNote ? (
                  <blockquote className="curator-hw-note">{item.submissionNote}</blockquote>
                ) : null}

                {item.submissionFileUrl?.startsWith('http') ? (
                  <a
                    href={item.submissionFileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="curator-link"
                  >
                    Открыть файл ответа
                  </a>
                ) : null}
                {item.submissionFileUrl?.startsWith('tg:') ? (
                  <p className="curator-muted">
                    Файл отправлен через Telegram — откройте в боте или попросите ученика переслать.
                  </p>
                ) : null}

                {item.status === 'submitted' ? (
                  <div className="curator-btn-row">
                    <button
                      type="button"
                      className="curator-btn curator-btn-accent"
                      disabled={busy}
                      onClick={() => approve(item)}
                    >
                      Принять
                    </button>
                    <button
                      type="button"
                      className="curator-btn curator-btn-danger"
                      disabled={busy}
                      onClick={() => onRejectTarget(item)}
                    >
                      На доработку
                    </button>
                  </div>
                ) : null}

                {rejectTarget?.sanityLessonId === item.sanityLessonId &&
                rejectTarget.studentId === item.studentId ? (
                  <div className="curator-reject-box">
                    <textarea
                      value={rejectNote}
                      onChange={(e) => onRejectNote(e.target.value)}
                      placeholder="Комментарий ученику (необязательно)"
                      rows={3}
                    />
                    <button
                      type="button"
                      className="curator-btn curator-btn-danger"
                      disabled={busy}
                      onClick={() => reject(item)}
                    >
                      Отправить на доработку
                    </button>
                  </div>
                ) : null}

                <CabinetFeedback feedback={feedbacks[key]} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
