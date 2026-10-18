'use client';

import { useEffect, useState } from 'react';
import type { HomeworkProgressStatus } from '@/lib/bot/education/course-progress';
import {
  deadlineUiState,
  HOMEWORK_DEADLINE_MS,
  type DeadlineUiPhase,
} from '@/lib/bot/education/homework-deadline';

export type HomeworkDeadlineBadgeProps = {
  homeworkStatus?: HomeworkProgressStatus | null;
  homeworkDeadlineAt?: string | null;
  homeworkRemainingMs?: number | null;
  homeworkOverdueAt?: string | null;
  compact?: boolean;
  /** inline — в ряд с текстом/бейджами; corner — правый верх карточки ДЗ; chip — pill в колонке ДЗ; block — под заголовком */
  placement?: 'inline' | 'corner' | 'chip' | 'block';
  /** Только обратный отсчёт, без статуса (плашка карты). */
  timerOnly?: boolean;
  className?: string;
};

export type DeadlineUrgency = 'ok' | 'half' | 'day' | 'critical' | 'status';

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0:00:00';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}д ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function resolveUrgency(phase: DeadlineUiPhase, remainingMs: number, totalMs: number): DeadlineUrgency {
  if (phase === 'waiting_review' || phase === 'approved' || phase === 'revision') return 'status';
  if (phase === 'overdue' || remainingMs <= 0) return 'critical';
  const TEN_H = 10 * 60 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;
  const half = Math.max(totalMs / 2, DAY); // half of 72h = 36h
  if (remainingMs < TEN_H) return 'critical';
  if (remainingMs < DAY) return 'day';
  if (remainingMs <= half) return 'half';
  return 'ok';
}

function DeadlineClockIcon() {
  return (
    <svg className="cab-hw-deadline-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 8v4.2l2.6 1.6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function DeadlineAlarmIcon() {
  return (
    <svg className="cab-hw-deadline-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.5 9.5a6.5 6.5 0 0113 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M4 4.5 2.5 6M20 4.5 21.5 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M8.5 19h7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M12 15.5V18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function labelForPhase(phase: DeadlineUiPhase, remainingMs: number): string | null {
  switch (phase) {
    case 'approved':
      return 'Одобрено';
    case 'waiting_review':
      return 'Ожидает проверки';
    case 'revision':
      return remainingMs > 0 ? `На доработку · ${formatRemaining(remainingMs)}` : 'На доработку';
    case 'overdue':
      return 'Срок истёк';
    case 'soon':
    case 'ok':
      return formatRemaining(remainingMs);
    default:
      return null;
  }
}

export default function HomeworkDeadlineBadge({
  homeworkStatus,
  homeworkDeadlineAt,
  homeworkRemainingMs,
  homeworkOverdueAt,
  compact,
  placement = 'block',
  timerOnly = false,
  className,
}: HomeworkDeadlineBadgeProps) {
  const [now, setNow] = useState(() => Date.now());

  const phase = deadlineUiState(
    {
      homework_status: homeworkStatus ?? 'pending',
      homework_deadline_at: homeworkDeadlineAt ?? null,
      homework_remaining_ms: homeworkRemainingMs ?? null,
      homework_overdue_at: homeworkOverdueAt ?? null,
    },
    new Date(now),
  );

  const ticking = phase === 'ok' || phase === 'soon' || phase === 'revision';

  useEffect(() => {
    if (!ticking || !homeworkDeadlineAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking, homeworkDeadlineAt]);

  const deadlineMs = homeworkDeadlineAt ? Date.parse(homeworkDeadlineAt) : NaN;
  const remainingMs =
    phase === 'waiting_review' || phase === 'approved'
      ? 0
      : Number.isFinite(deadlineMs)
        ? Math.max(0, deadlineMs - now)
        : Math.max(0, homeworkRemainingMs ?? 0);

  const label = labelForPhase(phase, remainingMs);
  if (!label || phase === 'none') return null;
  if (placement === 'chip' && (phase === 'waiting_review' || phase === 'approved')) return null;

  const urgency = resolveUrgency(phase, remainingMs, HOMEWORK_DEADLINE_MS);
  const isChip = placement === 'chip' || timerOnly;
  const showCountdownChip =
    isChip && (phase === 'ok' || phase === 'soon' || (phase === 'revision' && remainingMs > 0));
  const showExpiredChip = isChip && phase === 'overdue';

  if (timerOnly && !showCountdownChip && !showExpiredChip) return null;

  const rowTone =
    homeworkStatus === 'submitted'
      ? 'review'
      : homeworkStatus === 'rejected'
        ? phase === 'overdue'
          ? 'overdue'
          : 'revision'
        : homeworkStatus === 'approved'
          ? 'done'
          : phase === 'overdue'
            ? 'overdue'
            : urgency === 'half' || urgency === 'day' || urgency === 'critical'
              ? 'warn'
              : 'todo';

  return (
    <span
      className={[
        'cab-hw-deadline',
        `is-${phase}`,
        `is-urgency-${urgency}`,
        `is-place-${timerOnly ? 'inline' : placement}`,
        isChip ? 'is-pill' : '',
        compact ? 'is-compact' : '',
        `is-row-${rowTone}`,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={
        homeworkDeadlineAt
          ? `Дедлайн: ${new Date(homeworkDeadlineAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`
          : undefined
      }
    >
      {showCountdownChip ? (
        timerOnly ? (
          <>
            <DeadlineClockIcon />
            <span className="cab-hw-deadline-value">{formatRemaining(remainingMs)}</span>
          </>
        ) : (
          <>
            <DeadlineClockIcon />
            <span className="cab-hw-deadline-prefix">Срок сдачи</span>
            <span className="cab-hw-deadline-sep" aria-hidden="true" />
            <span className="cab-hw-deadline-value">{formatRemaining(remainingMs)}</span>
          </>
        )
      ) : showExpiredChip ? (
        timerOnly ? (
          <>
            <DeadlineAlarmIcon />
            <span className="cab-hw-deadline-value">00:00:00</span>
          </>
        ) : (
          <>
            <DeadlineAlarmIcon />
            <span className="cab-hw-deadline-label">Срок истёк</span>
          </>
        )
      ) : (
        <span className="cab-hw-deadline-label">{label}</span>
      )}
    </span>
  );
}
