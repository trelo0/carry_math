'use client';

import { useMemo, useState } from 'react';
import type { CuratorHomeworkBoardItem } from '@/lib/curator/students';
import { hwStatusLabel } from './curator-utils';

export default function CuratorHomeworkPanel({
  board,
  busy,
  rejectTarget,
  rejectNote,
  onRejectNote,
  onRejectTarget,
  onApprove,
  onReject,
}: {
  board: CuratorHomeworkBoardItem[];
  busy: boolean;
  rejectTarget: CuratorHomeworkBoardItem | null;
  rejectNote: string;
  onRejectNote: (v: string) => void;
  onRejectTarget: (item: CuratorHomeworkBoardItem | null) => void;
  onApprove: (item: CuratorHomeworkBoardItem) => void;
  onReject: (item: CuratorHomeworkBoardItem) => void;
}) {
  const [view, setView] = useState<'queue' | 'all'>('queue');
  const [moduleFilter, setModuleFilter] = useState<string>('all');

  const modules = useMemo(
    () => [...new Set(board.map((item) => item.moduleTitle))],
    [board],
  );

  const items = board.filter((item) => {
    if (view === 'queue' && item.status !== 'submitted') return false;
    if (moduleFilter !== 'all' && item.moduleTitle !== moduleFilter) return false;
    return true;
  });

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
          {items.map((item) => (
            <li key={`${item.studentId}-${item.sanityLessonId}`} className="curator-card">
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
                    onClick={() => onApprove(item)}
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
                    onClick={() => onReject(item)}
                  >
                    Отправить на доработку
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
