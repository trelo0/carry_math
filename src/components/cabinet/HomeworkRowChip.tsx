'use client';

import { useEffect, useState } from 'react';
import type { HomeworkProgressStatus } from '@/lib/bot/education/course-progress';
import { deadlineUiState, type DeadlineUiPhase } from '@/lib/bot/education/homework-deadline';

import type { HomeworkRowUiState } from '@/lib/cabinet-homework-row';

export type HomeworkRowChipRowState = HomeworkRowUiState;

type HomeworkRowChipProps = {
  row: HomeworkRowUiState;
  isJoinArchive?: boolean;
  homeworkStatus?: HomeworkProgressStatus | null;
  homeworkDeadlineAt?: string | null;
  homeworkRemainingMs?: number | null;
  homeworkOverdueAt?: string | null;
  trackDeadline?: boolean;
};

type ChipVariant =
  | 'locked'
  | 'todo'
  | 'warn'
  | 'overdue'
  | 'review'
  | 'done'
  | 'archive';

function formatRemaining(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}д ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function ClockIcon() {
  return (
    <svg className="cab-hw-deadline-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 8v4.2l2.6 1.6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="cab-hw-deadline-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 12.5l3.5 3.5L18 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlarmIcon() {
  return (
    <svg className="cab-hw-deadline-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.5 9.5a6.5 6.5 0 0113 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M4 4.5 2.5 6M20 4.5 21.5 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M8.5 19h7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function resolveTimeTone(phase: DeadlineUiPhase, remainingMs: number): 'todo' | 'warn' {
  if (phase === 'soon') return 'warn';
  const DAY = 24 * 60 * 60 * 1000;
  if (remainingMs < DAY) return 'warn';
  return 'todo';
}

export default function HomeworkRowChip({
  row,
  isJoinArchive,
  homeworkStatus,
  homeworkDeadlineAt,
  homeworkRemainingMs,
  homeworkOverdueAt,
  trackDeadline = true,
}: HomeworkRowChipProps) {
  const [now, setNow] = useState(() => Date.now());

  const phase = trackDeadline
    ? deadlineUiState(
        {
          homework_status: homeworkStatus ?? 'pending',
          homework_deadline_at: homeworkDeadlineAt ?? null,
          homework_remaining_ms: homeworkRemainingMs ?? null,
          homework_overdue_at: homeworkOverdueAt ?? null,
        },
        new Date(now),
      )
    : ('none' as DeadlineUiPhase);

  const status = homeworkStatus ?? 'pending';
  const ticking =
    trackDeadline &&
    (phase === 'ok' || phase === 'soon' || phase === 'revision' || phase === 'overdue');

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

  let icon: 'clock' | 'check' | 'alarm' | null = 'clock';
  let statusText = row.label;
  let timeText: string | null = null;
  let blink = false;
  let variant: ChipVariant = row.tone === 'locked' ? 'locked' : 'todo';

  if (isJoinArchive) {
    statusText = 'ДЗ не требуется';
    icon = null;
    variant = 'archive';
  } else if (row.tone === 'locked') {
    statusText = row.label;
    icon = 'clock';
    variant = 'locked';
  } else if (status === 'approved' || (row.tone === 'done' && !isJoinArchive)) {
    statusText = 'Одобрено';
    icon = 'check';
    variant = 'done';
  } else if (status === 'submitted') {
      statusText = 'Ожидает проверки';
    icon = 'clock';
    variant = 'review';
  } else if (status === 'rejected') {
    statusText = 'На доработке';
    icon = 'clock';
    variant = 'review';
    if (trackDeadline && phase === 'overdue') {
      timeText = '00:00:00';
      blink = true;
      icon = 'alarm';
      variant = 'overdue';
    } else if (
      trackDeadline &&
      (phase === 'ok' || phase === 'soon' || phase === 'revision') &&
      remainingMs > 0
    ) {
      timeText = formatRemaining(remainingMs);
      variant = resolveTimeTone(phase, remainingMs);
    }
  } else if (trackDeadline && phase === 'overdue') {
    statusText = 'Ожидает сдачи';
    timeText = '00:00:00';
    blink = true;
    icon = 'alarm';
    variant = 'overdue';
  } else if (
    trackDeadline &&
    (phase === 'ok' || phase === 'soon' || (phase === 'revision' && remainingMs > 0))
  ) {
    statusText = 'Ожидает сдачи';
    timeText = formatRemaining(remainingMs);
    icon = 'clock';
    variant = resolveTimeTone(phase, remainingMs);
  } else if (row.tone === 'todo') {
    statusText = 'Ожидает сдачи';
    icon = 'clock';
    variant = 'todo';
  }

  return (
    <span
      className={[
        'cab-hw-row-chip',
        'cab-hw-deadline',
        'is-pill',
        'is-place-chip',
        'is-compact',
        `is-row-${variant}`,
      ]
        .filter(Boolean)
        .join(' ')}
      title={
        homeworkDeadlineAt && trackDeadline
          ? `Дедлайн: ${new Date(homeworkDeadlineAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`
          : undefined
      }
    >
      {icon === 'check' ? <CheckIcon /> : icon === 'alarm' ? <AlarmIcon /> : icon === 'clock' ? <ClockIcon /> : null}
      <span className="cab-hw-deadline-prefix">{statusText}</span>
      {timeText ? (
        <>
          <span className="cab-hw-deadline-sep" aria-hidden="true" />
          <span className={`cab-hw-deadline-value${blink ? ' is-blink' : ''}`}>{timeText}</span>
        </>
      ) : null}
    </span>
  );
}
