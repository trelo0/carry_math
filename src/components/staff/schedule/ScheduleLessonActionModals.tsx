'use client';

import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { TeacherCabinetData, TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import { CANCEL_REASONS, type ScheduleEvent } from '@/lib/teacher/schedule-types';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runLessonMutationAsync } from '@/lib/teacher/schedule-lesson-async';
import { formatScheduleApiError, readJson } from '@/lib/teacher/schedule-api-errors';
import { patchTeacherLesson } from '@/lib/teacher/schedule-optimistic';
import {
  buildLocalIso,
  dateKey,
  durationFromRange,
  formatLessonDateTimeLine,
  isoToTimeLabel,
  minutesToTime,
  timeToMinutes,
} from '@/lib/teacher/schedule-utils';
import {
  getDayWorkState,
  isLessonOverlapPlacementError,
  LESSON_OVERLAP_ERROR_TEXT,
  validatePlacement,
  workBandsLabel,
} from '@/lib/teacher/schedule-reference-utils';
import type { TeacherWorkingHoursData } from '@/lib/teacher/working-hours';
import type { ScheduleTeacherApiContext } from '@/lib/teacher/schedule-api-context';
import {
  scheduleTeacherApiPath,
  withScheduleTeacherPayload,
} from '@/lib/teacher/schedule-api-context';
import { eventHeadline } from './ScheduleWeekBoard';
import { IconXRef } from './ScheduleRefIcons';
import FreeTimePicker from './FreeTimePicker';
import { ScheduleDateSelect, ScheduleDropdown, ScheduleTimeField } from './SchedulePickers';

type Common = {
  event: ScheduleEvent;
  busy: boolean;
  runAction: StaffRunAction;
  /** Куда показывать итог операции после закрытия окна. */
  report: Dispatch<SetStateAction<ActionFeedback | null>>;
  patchTeacher?: (patch: (prev: TeacherCabinetData) => TeacherCabinetData) => void;
  onClose: () => void;
  scheduleApi?: ScheduleTeacherApiContext;
};

export function Shell({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="sr-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className={`sr-modal${wide ? ' sr-modal--wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="sr-modal-head">
          <div>
            <h2 className="sr-modal-title">{title}</h2>
            {subtitle ? <p className="sr-modal-sub">{subtitle}</p> : null}
          </div>
          <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconXRef size={14} />
          </button>
        </header>
        <div className="sr-modal-body">{children}</div>
        <footer className="sr-modal-foot">{footer}</footer>
      </div>
    </div>
  );
}

function LessonSummary({ event }: { event: ScheduleEvent }) {
  return (
    <div className="sr-modal-summary">
      <strong>{eventHeadline(event)}</strong>
      <span>{formatLessonDateTimeLine(event.startsAt, event.endsAt)}</span>
    </div>
  );
}

/* ---------- Перенос ---------- */

type RescheduleProps = Common & {
  events: ScheduleEvent[];
  daySlots: TeacherDaySlot[];
  workingHours: TeacherWorkingHoursData;
};

export function ScheduleRescheduleModal({
  event,
  events,
  daySlots,
  workingHours,
  busy,
  runAction,
  report,
  patchTeacher,
  onClose,
  scheduleApi,
}: RescheduleProps) {
  const [date, setDate] = useState(() => dateKey(new Date(event.startsAt)));
  const [startTime, setStartTime] = useState(() => isoToTimeLabel(event.startsAt));
  const [endTime, setEndTime] = useState(() => isoToTimeLabel(event.endsAt));
  const [todayKey] = useState(() => dateKey(new Date()));
  const origDate = dateKey(new Date(event.startsAt));
  const origStart = isoToTimeLabel(event.startsAt);
  const origEnd = isoToTimeLabel(event.endsAt);

  const durationMinutes = useMemo(
    () => (startTime && endTime ? durationFromRange(startTime, endTime) : event.durationMinutes),
    [startTime, endTime, event.durationMinutes],
  );

  const pickStart = (time: string) => {
    setStartTime(time);
    if (timeToMinutes(endTime) <= timeToMinutes(time)) {
      setEndTime(
        minutesToTime(Math.min(timeToMinutes(time) + event.durationMinutes, 24 * 60 - 1)),
      );
    }
  };

  const day = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }, [date]);
  const work = getDayWorkState(workingHours, day);

  const unchanged = date === origDate && startTime === origStart && endTime === origEnd;
  const error = !date || !startTime || !endTime
    ? 'Укажите дату и время'
    : timeToMinutes(endTime) <= timeToMinutes(startTime)
      ? 'Конец должен быть позже начала'
      : unchanged
        ? null
        : validatePlacement({
            slotDate: date,
            startTime,
            endTime,
            events,
            daySlots,
            workingHours,
            excludeLessonId: event.lessonId,
          });
  const overlapError = isLessonOverlapPlacementError(error);
  const canSubmit = !error && !unchanged && !busy;

  const submit = () => {
    if (!canSubmit || event.lessonId == null) return;
    const lessonId = event.lessonId;
    const prevStartsAt = event.startsAt;
    const startsAt = buildLocalIso(date, startTime);
    runLessonMutationAsync(runAction, report, {
      successMessage: 'Занятие перенесено',
      onClose,
      applyOptimistic: () => {
        patchTeacher?.((prev) =>
          patchTeacherLesson(prev, lessonId, { startsAt, durationMinutes }),
        );
      },
      request: async () => {
        const res = await fetch(
          scheduleTeacherApiPath(scheduleApi, `/lessons/${lessonId}/reschedule`),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(withScheduleTeacherPayload(scheduleApi, { startsAt, durationMinutes })),
          },
        );
        if (!res.ok) {
          patchTeacher?.((prev) => patchTeacherLesson(prev, lessonId, { startsAt: prevStartsAt }));
          const body = await readJson<{ error: string }>(res);
          throw new Error(formatScheduleApiError(body.error, 'Не удалось перенести занятие', res.status));
        }
      },
    });
  };

  return (
    <Shell
      title="Перенести занятие"
      subtitle="Выберите новый день и время"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sr-btn sr-btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="sr-btn sr-btn--primary" disabled={!canSubmit} onClick={submit}>
            Перенести
          </button>
        </>
      }
    >
      <LessonSummary event={event} />
      <label className="sr-field">
        <span>Новый день</span>
        <ScheduleDateSelect value={date} minKey={todayKey} onChange={setDate} />
      </label>
      <div className={`sr-time-block${overlapError ? ' is-conflict' : ''}`}>
        <div className="sr-field-row">
          <label className="sr-field">
            <span>Начало</span>
            <ScheduleTimeField value={startTime} onChange={pickStart} aria-label="Начало" />
          </label>
          <label className="sr-field">
            <span>Конец</span>
            <ScheduleTimeField value={endTime} onChange={setEndTime} aria-label="Конец" />
          </label>
        </div>
        {overlapError ? (
          <p className="sr-time-conflict" role="alert">
            {LESSON_OVERLAP_ERROR_TEXT}
          </p>
        ) : null}
        {date ? (
          <FreeTimePicker
            day={day}
            events={events}
            daySlots={daySlots}
            workingHours={workingHours}
            excludeLessonId={event.lessonId}
            durationMinutes={durationMinutes}
            startTime={startTime}
            onPick={pickStart}
          />
        ) : null}
      </div>
      <p className="sr-modal-hint">
        {work.kind === 'work'
          ? `Рабочее время в этот день: ${workBandsLabel(work.bands)}. Длительность: ${durationMinutes} мин.`
          : work.kind === 'off'
            ? 'В этот день выходной.'
            : `Длительность: ${durationMinutes} мин.`}
      </p>
      {error && !overlapError ? <p className="sr-form-error">{error}</p> : null}
    </Shell>
  );
}

/* ---------- Отмена ---------- */

export function ScheduleCancelModal({
  event,
  busy,
  runAction,
  report,
  patchTeacher,
  onClose,
  onFinished,
  scheduleApi,
}: Common & {
  onFinished?: (lessonId: number) => void;
}) {
  const [reason, setReason] = useState<string>(CANCEL_REASONS[0].id);
  const [note, setNote] = useState('');

  const submit = () => {
    if (event.lessonId == null || busy) return;
    const lessonId = event.lessonId;
    const prevStatus = event.status;
    const prevCancelReason = null;
    const label = CANCEL_REASONS.find((item) => item.id === reason)?.label ?? reason;
    const reasonText = note.trim() ? `${label}: ${note.trim()}` : label;
    runLessonMutationAsync(runAction, report, {
      successMessage: 'Занятие отменено',
      onClose: () => {
        onFinished?.(lessonId);
        onClose();
      },
      applyOptimistic: () => {
        patchTeacher?.((prev) =>
          patchTeacherLesson(prev, lessonId, { status: 'cancelled', cancelReason: reasonText }),
        );
      },
      request: async () => {
        const res = await fetch(scheduleTeacherApiPath(scheduleApi, `/lessons/${lessonId}/cancel`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            withScheduleTeacherPayload(scheduleApi, { reason, reasonNote: reasonText }),
          ),
        });
        if (!res.ok) {
          patchTeacher?.((prev) =>
            patchTeacherLesson(prev, lessonId, { status: prevStatus, cancelReason: prevCancelReason }),
          );
          const body = await readJson<{ error: string }>(res);
          throw new Error(formatScheduleApiError(body.error, 'Не удалось отменить занятие', res.status));
        }
      },
    });
  };

  return (
    <Shell
      title="Отменить занятие"
      subtitle="Занятие пропадёт из календаря"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sr-btn sr-btn--ghost" onClick={onClose}>
            Назад
          </button>
          <button type="button" className="sr-btn sr-btn--danger" disabled={busy} onClick={submit}>
            Отменить занятие
          </button>
        </>
      }
    >
      <LessonSummary event={event} />
      <label className="sr-field">
        <span>Причина</span>
        <ScheduleDropdown
          value={reason}
          onChange={setReason}
          options={CANCEL_REASONS.map((item) => ({ value: item.id, label: item.label }))}
          placeholder="Выберите причину"
          aria-label="Причина отмены"
        />
      </label>
      <label className="sr-field">
        <span>Комментарий (необязательно)</span>
        <input type="text" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />
      </label>
    </Shell>
  );
}


