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
  timeToMinutes,
} from '@/lib/teacher/schedule-utils';
import {
  applyDayChange,
  bandsContain,
  resolveDayHours,
  type TeacherWorkingHoursData,
  type WeeklySlotInput,
} from '@/lib/teacher/working-hours';
import { eventsConflictingWithWeekly, proposedWorkingHours } from '@/lib/teacher/weekly-schedule-conflicts';
import { eventHeadline } from './ScheduleWeekBoard';
import { IconPalmRef, IconXRef } from './ScheduleRefIcons';
import { ScheduleDateSelect, ScheduleTimeField } from './SchedulePickers';

const WEEKDAYS = [
  { id: 0, label: 'Понедельник', short: 'Пн' },
  { id: 1, label: 'Вторник', short: 'Вт' },
  { id: 2, label: 'Среда', short: 'Ср' },
  { id: 3, label: 'Четверг', short: 'Чт' },
  { id: 4, label: 'Пятница', short: 'Пт' },
  { id: 5, label: 'Суббота', short: 'Сб' },
  { id: 6, label: 'Воскресенье', short: 'Вс' },
];

type DayDraft = { enabled: boolean; startTime: string; endTime: string };

type Move = { date: string; time: string };

type Props = {
  workingHours: TeacherWorkingHoursData;
  events: ScheduleEvent[];
  busy: boolean;
  runAction: StaffRunAction;
  report: Dispatch<SetStateAction<ActionFeedback | null>>;
  patchTeacher?: (patch: (prev: TeacherCabinetData) => TeacherCabinetData) => void;
  /** Добавить выходной на дату: открывает окно дня (там подтверждение и перенос занятий). */
  onAddOffDay: (date: string, note: string) => void;
  onClose: () => void;
};

function suggestMove(
  event: ScheduleEvent,
  from: Date,
  baseHours: TeacherWorkingHoursData,
  weekly: WeeklySlotInput[],
  events: ScheduleEvent[],
): Move {
  const time = isoToTimeLabel(event.startsAt);
  const endTime = isoToTimeLabel(event.endsAt);
  const wh = proposedWorkingHours(baseHours, weekly);
  for (let offset = 1; offset <= 21; offset += 1) {
    const candidate = addDays(from, offset);
    const key = dateKey(candidate);
    const resolved = resolveDayHours(wh, candidate);
    if (resolved.kind === 'off' || resolved.kind === 'unset') continue;
    if (resolved.kind === 'work' && !bandsContain(resolved.bands, time, endTime)) continue;
    const startsAt = buildLocalIso(key, time);
    const endsAt = buildLocalIso(key, endTime);
    if (findScheduleConflict(events, startsAt, endsAt, event.id)) continue;
    return { date: key, time };
  }
  return { date: dateKey(addDays(from, 1)), time };
}

function toDrafts(weekly: TeacherWorkingHoursData['weekly']): Record<number, DayDraft> {
  const drafts: Record<number, DayDraft> = {};
  for (const day of WEEKDAYS) {
    const slots = weekly.filter((slot) => slot.dayOfWeek === day.id);
    drafts[day.id] =
      slots.length === 0
        ? { enabled: false, startTime: '09:00', endTime: '18:00' }
        : {
            enabled: true,
            startTime: slots.map((s) => s.startTime).sort()[0],
            endTime: slots.map((s) => s.endTime).sort().slice(-1)[0],
          };
  }
  return drafts;
}

function formatDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  });
}

export default function ScheduleWorkingHoursModal({
  workingHours,
  events,
  busy,
  runAction,
  patchTeacher,
  onAddOffDay,
  onClose,
}: Props) {
  const sfetch = useScheduleFetch();
  const [drafts, setDrafts] = useState(() => toDrafts(workingHours.weekly));
  const [moves, setMoves] = useState<Record<number, Move>>({});
  const [saving, setSaving] = useState(false);
  const [offDate, setOffDate] = useState('');
  const [offNote, setOffNote] = useState('');
  const [todayKey] = useState(() => dateKey(new Date()));
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  const upcomingOff = useMemo(
    () => workingHours.blockedDates.filter((item) => item.blockedDate >= todayKey),
    [workingHours.blockedDates, todayKey],
  );
  const upcomingCustom = useMemo(
    () => workingHours.dayOverrides.filter((item) => item.overrideDate >= todayKey),
    [workingHours.dayOverrides, todayKey],
  );

  const invalidDay = WEEKDAYS.find((day) => {
    const draft = drafts[day.id];
    return draft.enabled && timeToMinutes(draft.endTime) <= timeToMinutes(draft.startTime);
  });

  const patch = (id: number, next: Partial<DayDraft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }));

  const weeklyDraft = useMemo((): WeeklySlotInput[] => {
    return WEEKDAYS.filter((day) => drafts[day.id].enabled).map((day) => ({
      dayOfWeek: day.id,
      startTime: drafts[day.id].startTime,
      endTime: drafts[day.id].endTime,
      kind: 'both' as const,
    }));
  }, [drafts]);

  const affected = useMemo(
    () => eventsConflictingWithWeekly(events, workingHours, weeklyDraft, todayKey),
    [events, workingHours, weeklyDraft, todayKey],
  );

  const suggestions = useMemo(() => {
    const map: Record<number, Move> = {};
    for (const event of affected) {
      if (event.lessonId == null) continue;
      map[event.lessonId] = suggestMove(event, new Date(event.startsAt), workingHours, weeklyDraft, events);
    }
    return map;
  }, [affected, events, workingHours, weeklyDraft]);

  const moveFor = (lessonId: number): Move => moves[lessonId] ?? suggestions[lessonId];
  const updateMove = (lessonId: number, patchMove: Partial<Move>) =>
    setMoves((prev) => ({ ...prev, [lessonId]: { ...moveFor(lessonId), ...patchMove } }));

  const applyWorkingHours = (next: TeacherWorkingHoursData | undefined) => {
    if (next) patchTeacher?.((prev) => ({ ...prev, workingHours: next }));
  };

  const saveWeekly = () => {
    if (invalidDay) {
      setFeedback({ type: 'error', message: `${invalidDay.label}: конец должен быть позже начала` });
      return;
    }
    for (const event of affected) {
      const lessonId = event.lessonId;
      if (lessonId == null) continue;
      const move = moveFor(lessonId);
      if (!move?.date || !move.time) {
        setFeedback({ type: 'error', message: 'Укажите новое время для всех конфликтующих занятий' });
        return;
      }
    }

    setSaving(true);
    void runWithFeedback(
      runAction,
      setFeedback,
      async () => {
        const movePayload = affected
          .filter((event) => event.lessonId != null)
          .map((event) => {
            const lessonId = event.lessonId!;
            const move = moveFor(lessonId);
            return {
              lessonId,
              startsAt: buildLocalIso(move.date, move.time),
              durationMinutes: event.durationMinutes,
            };
          });

        const res = await sfetch('/api/cabinet/teacher/availability/apply-week', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weekly: weeklyDraft, moves: movePayload }),
        });
        const json = await readJson<{ error: string; workingHours: TeacherWorkingHoursData }>(res);
        if (!res.ok) {
          throw new Error(formatScheduleApiError(json.error, 'Ошибка сохранения шаблона', res.status));
        }
        applyWorkingHours(json.workingHours);
        for (const move of movePayload) {
          patchTeacher?.((prev) => patchTeacherLesson(prev, move.lessonId, { startsAt: move.startsAt }));
        }
        onClose();
      },
      'Рабочее время сохранено',
      { refresh: 'teacher' },
    ).finally(() => setSaving(false));
  };
  const post = (payload: Record<string, unknown>, successText: string, clearDay?: string) => {
    const previous = workingHours;
    if (clearDay) {
      patchTeacher?.((prev) => ({ ...prev, workingHours: applyDayChange(prev.workingHours, clearDay, { type: 'clear' }) }));
    }
    return runWithFeedback(
      runAction,
      setFeedback,
      async () => {
        try {
          const res = await sfetch('/api/cabinet/teacher/availability', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const json = await readJson<{ error: string; workingHours: TeacherWorkingHoursData }>(res);
          if (!res.ok) throw new Error(formatScheduleApiError(json.error, 'Ошибка', res.status));
          applyWorkingHours(json.workingHours);
        } catch (error) {
          patchTeacher?.((prev) => ({ ...prev, workingHours: previous }));
          throw error;
        }
      },
      successText,
      { refresh: 'none' },
    );
  };
  const addOff = () => {
    if (!offDate) return;
    onAddOffDay(offDate, offNote.trim());
  };

  return (
    <div className="sr-modal-overlay" role="dialog" aria-modal="true" onClick={busy ? undefined : onClose}>
      <div className="sr-modal sr-modal--wide" onClick={(e) => e.stopPropagation()}>
        <header className="sr-modal-head">
          <div>
            <h2 className="sr-modal-title">Рабочее время</h2>
            <p className="sr-modal-sub">Шаблон недели — действует на все недели автоматически</p>
          </div>
          <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconXRef size={14} />
          </button>
        </header>

        <div className="sr-modal-body">
          <p className="sr-modal-intro">
            Включите рабочие дни и интервалы — они повторяются каждую неделю. Исключения на одну дату (выходной или
            особые часы) задайте в календаре: карандаш у выбранного дня в боковой панели.
          </p>
          <ul className="sr-week-list">
            {WEEKDAYS.map((day) => {
              const draft = drafts[day.id];
              return (
                <li key={day.id} className={`sr-week-row${draft.enabled ? '' : ' is-off'}`}>
                  <label className="sr-switch">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) => patch(day.id, { enabled: e.target.checked })}
                    />
                    <span className="sr-switch-track" aria-hidden />
                    <span className="sr-week-day">{day.label}</span>
                  </label>
                  {draft.enabled ? (
                    <div className="sr-week-time sr-week-time--dd">
                      <ScheduleTimeField
                        value={draft.startTime}
                        minuteStep={15}
                        onChange={(value) => patch(day.id, { startTime: value })}
                        aria-label={`${day.label}: начало`}
                      />
                      <span>—</span>
                      <ScheduleTimeField
                        value={draft.endTime}
                        minuteStep={15}
                        onChange={(value) => patch(day.id, { endTime: value })}
                        aria-label={`${day.label}: конец`}
                      />
                    </div>
                  ) : (
                    <span className="sr-week-off">
                      <IconPalmRef size={14} /> Выходной
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {affected.length > 0 ? (
            <section className="sr-modal-section">
              <h3 className="sr-modal-section-title">
                Конфликты с шаблоном ({affected.length})
              </h3>
              <p className="sr-modal-hint">
                Перенесите занятия или отмените изменение шаблона. Сохранение применит переносы и новый график вместе.
              </p>
              <ul className="sr-conflict-list">
                {affected.map((event) => {
                  const lessonId = event.lessonId!;
                  const move = moveFor(lessonId);
                  return (
                    <li key={event.id} className="sr-conflict-row">
                      <div>
                        <strong>{eventHeadline(event)}</strong>
                        <span>{isoToTimeLabel(event.startsAt)} · {dateKey(new Date(event.startsAt))}</span>
                      </div>
                      <div className="sr-field-row">
                        <ScheduleDateSelect
                          value={move?.date ?? ''}
                          minKey={todayKey}
                          onChange={(value) => updateMove(lessonId, { date: value })}
                        />
                        <ScheduleTimeField
                          value={move?.time ?? ''}
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

          <section className="sr-modal-section sr-modal-section--muted">
            <h3 className="sr-modal-section-title">Ближайшие выходные (шаблон)</h3>
            <p className="sr-modal-hint">
              Быстро отметить дату выходным. Точная настройка дня — в календаре через «карандаш» у дня.
            </p>
            <div className="sr-field-row sr-field-row--end">
              <label className="sr-field">
                <span>Дата</span>
                <ScheduleDateSelect value={offDate} minKey={todayKey} onChange={setOffDate} />
              </label>
              <label className="sr-field sr-field--grow">
                <span>Комментарий</span>
                <input
                  type="text"
                  value={offNote}
                  maxLength={80}
                  placeholder="Необязательно"
                  onChange={(e) => setOffNote(e.target.value)}
                />
              </label>
              <button type="button" className="sr-btn sr-btn--ghost" disabled={busy || !offDate} onClick={addOff}>
                Сделать выходным
              </button>
            </div>

            {upcomingOff.length === 0 && upcomingCustom.length === 0 ? (
              <p className="sr-muted">Исключений на ближайшие даты нет</p>
            ) : (
              <ul className="sr-exc-list">
                {upcomingOff.map((item) => (
                  <li key={`off-${item.id}`} className="sr-exc-row">
                    <span className="sr-exc-text">
                      <strong>{formatDate(item.blockedDate)}</strong>
                      <span>{item.note?.trim() || 'Выходной'}</span>
                    </span>
                    <button
                      type="button"
                      className="sr-link"
                      disabled={busy}
                      onClick={() => void post({ action: 'unblock', blockedId: item.id }, 'Выходной удалён', item.blockedDate)}
                    >
                      Убрать
                    </button>
                  </li>
                ))}
                {upcomingCustom.map((item) => (
                  <li key={`custom-${item.id}`} className="sr-exc-row">
                    <span className="sr-exc-text">
                      <strong>{formatDate(item.overrideDate)}</strong>
                      <span>
                        Особое время: {item.startTime} – {item.endTime}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="sr-link"
                      disabled={busy}
                      onClick={() =>
                        void post({ action: 'clearDay', date: item.overrideDate }, 'День возвращён к шаблону', item.overrideDate)
                      }
                    >
                      Сбросить
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <CabinetFeedback feedback={feedback} />
        </div>

        <footer className="sr-modal-foot">
          <button type="button" className="sr-btn sr-btn--ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="sr-btn sr-btn--primary" disabled={busy || saving} onClick={saveWeekly}>
            {saving
              ? 'Сохраняем…'
              : affected.length > 0
                ? `Перенести ${affected.length} и сохранить`
                : 'Сохранить шаблон'}
          </button>
        </footer>
      </div>
    </div>
  );
}

