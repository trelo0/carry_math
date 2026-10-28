'use client';

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useScheduleFetch } from './schedule-api-react';
import type { TeacherCabinetData, TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import { formatScheduleApiError, readJson } from '@/lib/teacher/schedule-api-errors';
import {
  buildLocalIso,
  dateKey,
  durationFromRange,
  minutesToTime,
  timeToMinutes,
} from '@/lib/teacher/schedule-utils';
import {
  addTeacherLesson,
  addTeacherLessons,
  createOptimisticLesson,
  nextOptimisticLessonId,
  reconcileSeriesLessons,
  removeTeacherLesson,
  removeTeacherLessons,
  replaceTeacherLessonId,
} from '@/lib/teacher/schedule-optimistic';
import { runLessonMutationAsync } from '@/lib/teacher/schedule-lesson-async';
import { buildSeriesOccurrences, SERIES_DEFAULT_WEEKS, weekdayIndex } from '@/lib/teacher/lesson-series';
import {
  getDayWorkState,
  isLessonOverlapPlacementError,
  LESSON_OVERLAP_ERROR_TEXT,
  validatePlacement,
  workBandsLabel,
} from '@/lib/teacher/schedule-reference-utils';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import type { ScheduleTeacherApiContext } from '@/lib/teacher/schedule-api-context';
import {
  scheduleTeacherApiPath,
  withScheduleTeacherPayload,
} from '@/lib/teacher/schedule-api-context';
import CabinetFeedback from '@/components/ui/CabinetFeedback';
import { IconXRef } from './ScheduleRefIcons';
import FreeTimePicker from './FreeTimePicker';
import { ScheduleDateSelect, ScheduleRosterSelect, ScheduleTimeField } from './SchedulePickers';

type Props = {
  data: TeacherCabinetData;
  events: ScheduleEvent[];
  daySlots: TeacherDaySlot[];
  initialDate?: Date;
  initialKind?: 'individual' | 'group';
  initialStartTime?: string;
  initialEndTime?: string;
  busy: boolean;
  report: Dispatch<SetStateAction<ActionFeedback | null>>;
  patchTeacher?: (patch: (prev: TeacherCabinetData) => TeacherCabinetData) => void;
  onClose: () => void;
  runAction: StaffRunAction;
  scheduleApi?: ScheduleTeacherApiContext;
};

const WEEK_OPTIONS = [4, 8, 12, 24];
const WEEKDAYS_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

export default function ScheduleAddModal({
  data,
  events,
  daySlots,
  initialDate,
  initialKind = 'individual',
  initialStartTime,
  initialEndTime,
  busy,
  report,
  patchTeacher,
  onClose,
  runAction,
  scheduleApi,
}: Props) {
  const sfetch = useScheduleFetch();
  const allowSeries = true;
  const [kind, setKind] = useState<'individual' | 'group'>(initialKind);
  const [slotDate, setSlotDate] = useState(() => dateKey(initialDate ?? new Date()));
  const [startTime, setStartTime] = useState(initialStartTime ?? '10:00');
  const [endTime, setEndTime] = useState(initialEndTime ?? '11:15');
  const [participant, setParticipant] = useState('');
  const [rosterId, setRosterId] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [weeks, setWeeks] = useState(SERIES_DEFAULT_WEEKS);
  const [topic, setTopic] = useState('');
  const [comment, setComment] = useState('');
  const [showError, setShowError] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [todayKey] = useState(() => dateKey(new Date()));

  const day = useMemo(() => {
    const [y, m, d] = slotDate.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }, [slotDate]);
  const work = getDayWorkState(data.workingHours, day);

  const error = useMemo(() => {
    if (!slotDate || !startTime || !endTime) return 'Укажите дату и время';
    return validatePlacement({
      slotDate,
      startTime,
      endTime,
      events,
      daySlots,
      workingHours: data.workingHours,
    });
  }, [slotDate, startTime, endTime, events, daySlots, data.workingHours]);

  const overlapError = isLessonOverlapPlacementError(error);
  const showPlacementError = Boolean(error && (showError || (slotDate && startTime && endTime)));

  const duration = startTime && endTime ? timeToMinutes(endTime) - timeToMinutes(startTime) : 0;

  const pickStart = (time: string) => {
    const length = duration > 0 ? duration : 60;
    setStartTime(time);
    setEndTime(minutesToTime(Math.min(timeToMinutes(time) + length, 24 * 60 - 1)));
  };

  const rosterStudent =
    kind === 'individual' && rosterId ? data.roster.find((s) => String(s.id) === rosterId) : undefined;

  const submit = () => {
    if (error) {
      setShowError(true);
      return;
    }
    const startsAt = buildLocalIso(slotDate, startTime);
    const durationMinutes = durationFromRange(startTime, endTime);
    const participantName = kind === 'individual' ? (rosterStudent?.name ?? '') : participant.trim();

    const lessonFields = {
      kind,
      durationMinutes,
      topic: topic.trim() || 'Занятие',
      studentName: kind === 'individual' ? participantName || null : null,
      groupTitle: kind === 'group' ? participantName || null : null,
      lessonPlan: comment.trim() || null,
      scheduleStudentId: rosterStudent?.id ?? null,
    };

    if (repeat) {
      const occurrences = buildSeriesOccurrences({
        fromDate: slotDate,
        weekdays: [weekdayIndex(day)],
        startTime,
        weeks,
      });
      const tempIdByStartsAt = new Map<string, number>();
      const tempIds: number[] = [];
      for (const occStartsAt of occurrences) {
        const tempId = nextOptimisticLessonId();
        tempIdByStartsAt.set(occStartsAt, tempId);
        tempIds.push(tempId);
      }

      runLessonMutationAsync(runAction, (msg) => {
        setFeedback(msg);
        if (msg) report(msg);
      }, {
        successMessage: `Добавлено в календарь: ${occurrences.length}`,
        onClose,
        applyOptimistic: () => {
          patchTeacher?.((prev) =>
            addTeacherLessons(
              prev,
              occurrences.map((occStartsAt) =>
                createOptimisticLesson({
                  id: tempIdByStartsAt.get(occStartsAt)!,
                  startsAt: occStartsAt,
                  ...lessonFields,
                }),
              ),
            ),
          );
        },
        request: async () => {
          const res = await sfetch('/api/cabinet/teacher/schedule/series', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              withScheduleTeacherPayload(scheduleApi, {
                kind,
                scheduleStudentId: rosterStudent?.id,
                participantName: kind === 'group' ? participantName || undefined : undefined,
                topic: topic.trim() || undefined,
                lessonPlan: comment.trim() || undefined,
                occurrences,
                endTime,
              }),
            ),
          });
          const body = await readJson<{
            error: string;
            seriesId: string;
            lessons: { id: number; startsAt: string }[];
            skipped: { startsAt: string; reason: string }[];
          }>(res);
          if (!res.ok) {
            patchTeacher?.((prev) => removeTeacherLessons(prev, tempIds));
            throw new Error(formatScheduleApiError(body.error, 'Не удалось создать занятия', res.status));
          }
          const created = body.lessons ?? [];
          patchTeacher?.((prev) => reconcileSeriesLessons(prev, tempIdByStartsAt, created, body.seriesId));
          const skipped = body.skipped ?? [];
          if (skipped.length > 0) {
            return `Создано: ${created.length}. Пропущено дат: ${skipped.length}`;
          }
          return undefined;
        },
      });
      return;
    }

    const tempId = nextOptimisticLessonId();
    runLessonMutationAsync(runAction, (msg) => {
      setFeedback(msg);
      if (msg) report(msg);
    }, {
      successMessage: 'Занятие добавлено',
      onClose,
      applyOptimistic: () => {
        patchTeacher?.((prev) =>
          addTeacherLesson(
            prev,
            createOptimisticLesson({
              id: tempId,
              startsAt,
              ...lessonFields,
            }),
          ),
        );
      },
      request: async () => {
        const payload: Record<string, unknown> = {
          kind,
          startsAt,
          endTime,
          topic: topic.trim() || undefined,
          lessonPlan: comment.trim() || undefined,
          participantName: participantName || undefined,
          scheduleStudentId: rosterStudent?.id,
        };
        const res = await fetch(scheduleTeacherApiPath(scheduleApi, '/schedule'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withScheduleTeacherPayload(scheduleApi, payload)),
        });
        const body = await readJson<{ error: string; lessonId: number; lessonIds: number[] }>(res);
        if (!res.ok) {
          patchTeacher?.((prev) => removeTeacherLesson(prev, tempId));
          throw new Error(formatScheduleApiError(body.error, 'Не удалось создать занятие', res.status));
        }
        const lessonId = body.lessonId ?? body.lessonIds?.[0];
        if (lessonId) {
          patchTeacher?.((prev) => replaceTeacherLessonId(prev, tempId, lessonId));
        }
      },
    });
  };
  return (
    <div className="sr-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sr-modal sr-modal--wide" onClick={(e) => e.stopPropagation()}>
        <header className="sr-modal-head">
          <div>
            <h2 className="sr-modal-title">Новое занятие</h2>
            <p className="sr-modal-sub">
              {work.kind === 'work'
                ? `Рабочее время: ${workBandsLabel(work.bands)}`
                : work.kind === 'off'
                  ? 'В выбранный день выходной'
                  : 'Рабочее время не задано'}
            </p>
          </div>
          <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconXRef size={14} />
          </button>
        </header>

        <div className="sr-modal-body">
          <div className="sr-seg" role="tablist" aria-label="Тип занятия">
            <button
              type="button"
              role="tab"
              aria-selected={kind === 'individual'}
              className={`sr-seg-btn${kind === 'individual' ? ' is-active' : ''}`}
              onClick={() => setKind('individual')}
            >
              Индивидуальное
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={kind === 'group'}
              className={`sr-seg-btn${kind === 'group' ? ' is-active' : ''}`}
              onClick={() => setKind('group')}
            >
              Групповое
            </button>
          </div>

          <div className={`sr-time-block${overlapError && showPlacementError ? ' is-conflict' : ''}`}>
            <div className="sr-field-row">
              <label className="sr-field sr-field--grow">
                <span>Дата</span>
                <ScheduleDateSelect value={slotDate} minKey={todayKey} onChange={setSlotDate} />
              </label>
              <label className="sr-field">
                <span>Начало</span>
                <ScheduleTimeField value={startTime} onChange={pickStart} aria-label="Начало" />
              </label>
              <label className="sr-field">
                <span>Конец</span>
                <ScheduleTimeField value={endTime} onChange={setEndTime} aria-label="Конец" />
              </label>
            </div>
            {overlapError && showPlacementError ? (
              <p className="sr-time-conflict" role="alert">
                {LESSON_OVERLAP_ERROR_TEXT}
              </p>
            ) : null}
            <FreeTimePicker
              day={day}
              events={events}
              daySlots={daySlots}
              workingHours={data.workingHours}
              durationMinutes={duration > 0 ? duration : 60}
              startTime={startTime}
              onPick={pickStart}
            />
          </div>

          {kind === 'individual' ? (
            <label className="sr-field">
              <span>Ученик</span>
              <ScheduleRosterSelect value={rosterId} roster={data.roster} onChange={setRosterId} />
              {data.roster.length === 0 ? (
                <small className="sr-modal-hint">Список пуст — добавьте учеников в блоке «Мои ученики».</small>
              ) : null}
            </label>
          ) : (
            <label className="sr-field">
              <span>Группа</span>
              <input
                type="text"
                value={participant}
                placeholder="Название группы"
                onChange={(e) => setParticipant(e.target.value)}
              />
            </label>
          )}
          <label className="sr-field">
            <span>Тема</span>
            <input
              type="text"
              value={topic}
              placeholder="Например, Алгебра"
              onChange={(e) => setTopic(e.target.value)}
            />
          </label>
          <label className="sr-field">
            <span>Комментарий</span>
            <textarea
              value={comment}
              rows={2}
              placeholder="Необязательно"
              onChange={(e) => setComment(e.target.value)}
            />
          </label>

          {allowSeries ? (
            <label className="sr-check">
              <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
              <span>Повторять каждую неделю ({WEEKDAYS_FULL[weekdayIndex(day)]})</span>
            </label>
          ) : null}
          {allowSeries && repeat ? (
            <div className="sr-chips" aria-label="Количество недель">
              {WEEK_OPTIONS.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={`sr-chip${weeks === count ? ' is-active' : ''}`}
                  onClick={() => setWeeks(count)}
                >
                  {count} нед.
                </button>
              ))}
            </div>
          ) : null}
          {showPlacementError && error && !overlapError ? (
            <p className="sr-form-error">{error}</p>
          ) : null}
          <CabinetFeedback feedback={feedback} />
        </div>

        <footer className="sr-modal-foot">
          <button type="button" className="sr-btn sr-btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="sr-btn sr-btn--primary" disabled={busy || Boolean(error)} onClick={submit}>
            Добавить занятие
          </button>
        </footer>
      </div>
    </div>
  );
}




