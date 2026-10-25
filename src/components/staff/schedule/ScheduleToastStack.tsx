'use client';

import { useEffect } from 'react';
import type { ActionFeedback } from '@/lib/staff/run-action';
import { IconCheckRef, IconXRef } from './ScheduleRefIcons';

type Props = {
  feedback: ActionFeedback | null;
  onDismiss: () => void;
  /** Автоскрытие, мс (0 — не скрывать). */
  autoHideMs?: number;
};

/** Всплывающие уведомления расписания — правый верхний угол экрана. */
export default function ScheduleToastStack({ feedback, onDismiss, autoHideMs = 5500 }: Props) {
  useEffect(() => {
    if (!feedback || autoHideMs <= 0) return;
    const timer = window.setTimeout(onDismiss, autoHideMs);
    return () => window.clearTimeout(timer);
  }, [feedback, autoHideMs, onDismiss]);

  if (!feedback) return null;

  const isError = feedback.type === 'error';

  return (
    <div className="sr-toast-stack" role="region" aria-label="Уведомления">
      <div className={`sr-toast sr-toast--${feedback.type}`} role="status">
        <span className="sr-toast-ico" aria-hidden>
          {isError ? <IconXRef size={16} /> : <IconCheckRef size={16} />}
        </span>
        <p className="sr-toast-text">{feedback.message}</p>
        <button type="button" className="sr-toast-close" onClick={onDismiss} aria-label="Закрыть">
          <IconXRef size={14} />
        </button>
      </div>
    </div>
  );
}
