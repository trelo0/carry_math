'use client';

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useScheduleFetch } from './schedule-api-react';
import type { TeacherCabinetData } from '@/lib/teacher/cabinet-data';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runWithFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';
import { formatScheduleApiError, readJson } from '@/lib/teacher/schedule-api-errors';
import { patchTeacherLesson } from '@/lib/teacher/schedule-optimistic';
import {
  addDays,
  buildLocalIso,
  dateKey,
  findScheduleConflict,
  isoToTimeLabel,
  lessonEndIso,
  timeToMinutes,
} from '@/lib/teacher/schedule-utils';
import { formatDayHeading } from '@/lib/teacher/schedule-reference-utils';
import {
  applyDayChange,
  bandsContain,
  resolveDayHours,
  type DayChange,
  type TeacherWorkingHoursData,
} from '@/lib/teacher/working-hours';
import { eventHeadline } from './ScheduleWeekBoard';
import { ScheduleDateSelect, ScheduleTimeField } from './SchedulePickers';
import { IconPalmRef, IconXRef } from './ScheduleRefIcons';

type Props = {
  day: Date;
  initialMode?: 'work' | 'off';
  initialNote?: string;
  workingHours: TeacherWorkingHoursData;
  events: ScheduleEvent[];
  busy: boolean;
  runAction: StaffRunAction;
  /** Итог фоновой операции (окно закрывается сразу после оптимистичного применения). */
  report: Dispatch<SetStateAction<ActionFeedback | null>>;
  patchTeacher?: (patch: (prev: TeacherCabinetData) => TeacherCabinetData) => void;
  onClose: () => void;
};

type Move = { date: string; time: string };

/** Ближайший день, где занятие помещается в рабочие часы и не пересекается с другими. */
function suggestMove(
  event: ScheduleEvent,
  from: Date,
  workingHours: TeacherWorkingHoursData,
  events: ScheduleEvent[],
): Move {
  const time = isoToTimeLabel(event.startsAt);
  const endTime = isoToTimeLabel(event.endsAt);
  for (let offset = 1; offset <= 21; offset += 1) {
    const candidate = addDays(from, offset);
    const resolved = resolveDayHours(workingHours, candidate);
    if (resolved.kind === 'off') continue;
    if (resolved.kind === 'work' && !bandsContain(resolved.bands, time, endTime)) continue;
    const key = dateKey(candidate);
    const startsAt = buildLocalIso(key, time);
    const endsAt = lessonEndIso(startsAt, event.durationMinutes);
    if (findScheduleConflict(events, startsAt, endsAt, event.id)) continue;
    return { date: key, time };
  }
  return { date: dateKey(addDays(from, 1)), time };
}

export default function ScheduleDayHoursModal({
  day,
  initialMode,
  initialNote,
  workingHours,
  events,
  busy,
  runAction,
  report,
  patchTeacher,
  onClose,
}: Props) {
  const sfetch = useScheduleFetch();
  const key = dateKey(day);
  const resolved = useMemo(() => resolveDayHours(workingHours, day), [workingHours, day]);

  const [mode, setMode] = useState<'work' | 'off'>(
    initialMode ?? (resolved.kind === 'off' ? 'off' : 'work'),
  );
  const [startTime, setStartTime] = useState(
    resolved.kind === 'work' ? resolved.bands[0].startTime : '09:00',
  );
  const [endTime, setEndTime] = useState(
    resolved.kind === 'work' ? resolved.bands[resolved.bands.length - 1].endTime : '18:00',
  );
  const [note, setNote] = useState(initialNote ?? (resolved.kind === 'off' ? (resolved.note ?? '') : ''));
  const [moves, setMoves] = useState<Record<number, Move>>({});
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [saving, setSaving] = useState(false);
  const [todayKey] = useState(() => dateKey(new Date()));

  const hoursValid = mode === 'off' || timeToMinutes(endTime) > timeToMinutes(startTime);

  const dayLessons = useMemo(
    () =>
      events.filter(
        (event) =>
          event.kind !== 'course' &&
          event.status === 'scheduled' &&
          event.lessonId != null &&
          dateKey(new Date(event.startsAt)) === key,
      ),
    [events, key],
  );

  const affected = useMemo(() => {
    if (mode === 'off') return dayLessons;
    if (!hoursValid) return [];
    return dayLessons.filter(
      (event) => !bandsContain([{ startTime, endTime }], isoToTimeLabel(event.startsAt), isoToTimeLabel(event.endsAt)),
    );
  }, [mode, dayLessons, hoursValid, startTime, endTime]);

  const suggestions = useMemo(() => {
    const map: Record<number, Move> = {};
    for (const event of affected) {
      if (event.lessonId != null) map[event.lessonId] = suggestMove(event, day, workingHours, events);
    }
    return map;
  }, [affected, day, workingHours, events]);

  const moveFor = (lessonId: number): Move => moves[lessonId] ?? suggestions[lessonId];
  const updateMove = (lessonId: number, patch: Partial<Move>) =>
    setMoves((prev) => ({ ...prev, [lessonId]: { ...moveFor(lessonId), ...patch } }));

  const canClear =
    resolved.kind === 'work' ? resolved.custom : resolved.kind === 'off' && resolved.blockedId != null;

  const applyWorkingHours = (next: TeacherWorkingHoursData | undefined) => {
    if (!next) return;
    patchTeacher?.((prev) => ({ ...prev, workingHours: next }));
  };

  const postAvailability = async (payload: Record<string, unknown>) => {
    const res = await sfetch('/api/cabinet/teacher/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await readJson<{ error: string; workingHours: TeacherWorkingHoursData }>(res);
    if (!res.ok) throw new Error(formatScheduleApiError(json.error, 'Не удалось сохранить', res.status));
    applyWorkingHours(json.workingHours);
  };

  /** Без занятий на переносе: применяем сразу, сервер подтверждает в фоне, при ошибке откатываем. */
  const applyOptimistic = (change: DayChange, payload: Record<string, unknown>, successText: string) => {
    const previous = workingHours;
    patchTeacher?.((prev) => ({ ...prev, workingHours: applyDayChange(prev.workingHours, key, change) }));
    onClose();
    void runWithFeedback(
      runAction,
      report,
      async () => {
        try {
          await postAvailability(payload);
        } catch (error) {
          patchTeacher?.((prev) => ({ ...prev, workingHours: previous }));
          throw error;
        }
      },
      successText,
      { refresh: 'none' },
    );
  };

  const save = () => {
    if (!hoursValid) {
      setFeedback({ type: 'error', message: 'Конец рабочего дня должен быть позже начала' });
      return;
    }

    if (affected.length === 0) {
      if (mode === 'off') {
        applyOptimistic(
          { type: 'off', note: note.trim() || null },
          { action: 'block', blockedDate: key, note: note.trim() || null },
          'День отмечен как выходной',
        );
      } else {
        applyOptimistic(
          { type: 'hours', startTime, endTime },
          { action: 'setDayHours', date: key, startTime, endTime },
          'Рабочее время дня сохранено',
        );
      }
      return;
    }

    setSaving(true);
    void runWithFeedback(
      runAction,
      setFeedback,
      async () => {
        const moves = affected.map((event) => {
          const lessonId = event.lessonId!;
          const move = moveFor(lessonId);
          if (!move?.date || !move.time) {
            throw new Error('Укажите новую дату и время для каждого занятия');
          }
          return {
            lessonId,
            startsAt: buildLocalIso(move.date, move.time),
            durationMinutes: event.durationMinutes,
          };
        });

        const res = await sfetch('/api/cabinet/teacher/availability/apply-day', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: key,
            mode,
            startTime: mode === 'work' ? startTime : undefined,
            endTime: mode === 'work' ? endTime : undefined,
            note: note.trim() || null,
            moves,
          }),
        });
        const json = await readJson<{ error: string; workingHours: TeacherWorkingHoursData }>(res);
        if (!res.ok) {
          throw new Error(formatScheduleApiError(json.error, 'Не удалось сохранить день', res.status));
        }
        applyWorkingHours(json.workingHours);
        for (const move of moves) {
          patchTeacher?.((prev) => patchTeacherLesson(prev, move.lessonId, { startsAt: move.startsAt }));
        }
        onClose();
      },
      mode === 'off' ? 'День отмечен как выходной' : 'Рабочее время дня сохранено',
      { refresh: 'teacher' },
    ).finally(() => setSaving(false));
  };

  const clear = () => {
    applyOptimistic({ type: 'clear' }, { action: 'clearDay', date: key }, 'День возвращён к шаблону');
  };
  const saveLabel = saving
    ? 'Сохраняем…'
    : affected.length > 0
      ? `Перенести ${affected.length} ${affected.length === 1 ? 'занятие' : 'занятий'} и сохранить`
      : 'Сохранить';

  return (
    <div className="sr-modal-overlay" role="dialog" aria-modal="true" onClick={busy ? undefined : onClose}>
      <div className="sr-modal" onClick={(e) => e.stopPropagation()}>
        <header className="sr-modal-head">
          <div>
            <h2 className="sr-modal-title">Рабочее время дня</h2>
            <p className="sr-modal-sub">{formatDayHeading(day, 0)}</p>
          </div>
          <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconXRef size={14} />
          </button>
        </header>

        <div className="sr-modal-body">
          <p className="sr-modal-hint">
            Изменение действует только на этот день, недельный шаблон остаётся прежним.
          </p>

          <div className="sr-seg" role="tablist" aria-label="Тип дня">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'work'}
              className={`sr-seg-btn${mode === 'work' ? ' is-active' : ''}`}
              onClick={() => setMode('work')}
            >
              Рабочий день
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'off'}
              className={`sr-seg-btn${mode === 'off' ? ' is-active' : ''}`}
              onClick={() => setMode('off')}
            >
              <IconPalmRef size={14} /> Выходной
            </button>
          </div>

          {mode === 'work' ? (
            <div className="sr-field-row">
              <label className="sr-field">
                <span>Начало</span>
                <ScheduleTimeField
                  value={startTime}
                  minuteStep={15}
                  onChange={setStartTime}
                  aria-label="Начало"
                />
              </label>
              <label className="sr-field">
                <span>Конец</span>
                <ScheduleTimeField
                  value={endTime}
                  minuteStep={15}
                  onChange={setEndTime}
                  aria-label="Конец"
                />
              </label>
            </div>
          ) : (
            <label className="sr-field">
              <span>Комментарий (необязательно)</span>
              <input
                type="text"
                value={note}
                maxLength={80}
                placeholder="Например, отпуск"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}

          {affected.length > 0 ? (
            <section className="sr-warn" aria-live="polite">
              <h3 className="sr-warn-title">
                {mode === 'off' ? 'В этот день есть занятия' : 'Часть занятий выходит за рабочее время'}
              </h3>
              <p className="sr-modal-hint">
                Их нужно перенести — выберите новые дату и время. Занятия будут перенесены сразу при сохранении.
              </p>
              <ul className="sr-move-list">
                {affected.map((event) => {
                  const lessonId = event.lessonId!;
                  const move = moveFor(lessonId);
                  return (
                    <li key={event.id} className="sr-move-row">
                      <div className="sr-move-info">
                        <strong>{eventHeadline(event)}</strong>
                        <span>
                          {isoToTimeLabel(event.startsAt)} – {isoToTimeLabel(event.endsAt)}
                        </span>
                      </div>
                      <div className="sr-move-input sr-move-dd">
                        <ScheduleDateSelect
                          value={move.date}
                          minKey={todayKey}
                          onChange={(value) => updateMove(lessonId, { date: value })}
                        />
                      </div>
                      <div className="sr-move-input sr-move-dd">
                        <ScheduleTimeField
                          value={move.time}
                          onChange={(value) => updateMove(lessonId, { time: value })}
                          aria-label="Время"
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <CabinetFeedback feedback={feedback} />
        </div>

        <footer className="sr-modal-foot">
          {canClear ? (
            <button type="button" className="sr-btn sr-btn--ghost sr-modal-foot-left" disabled={busy} onClick={clear}>
              Вернуть к шаблону
            </button>
          ) : null}
          <button type="button" className="sr-btn sr-btn--ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="sr-btn sr-btn--primary" disabled={busy || saving || !hoursValid} onClick={save}>
            {saveLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

