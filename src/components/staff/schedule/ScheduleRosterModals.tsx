'use client';

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { TeacherCabinetData, TeacherRosterStudent } from '@/lib/teacher/cabinet-data';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runWithFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';
import { formatScheduleApiError, readJson } from '@/lib/teacher/schedule-api-errors';
import {
  addTeacherLessons,
  createOptimisticLesson,
  nextOptimisticLessonId,
  reconcileSeriesLessons,
  removeTeacherLessons,
  cancelLessonsByIds,
  removeRosterStudentCompletely,
  setRosterArchiveState,
  upsertRosterStudent,
} from '@/lib/teacher/schedule-optimistic';
import { runLessonMutationAsync } from '@/lib/teacher/schedule-lesson-async';
import {
  dateKey,
  durationFromRange,
  isoToTimeLabel,
  minutesToTime,
  timeToMinutes,
} from '@/lib/teacher/schedule-utils';
import { buildSeriesOccurrences, SERIES_DEFAULT_WEEKS, weekdayIndex } from '@/lib/teacher/lesson-series';
import {
  initialsOf,
  rosterLessonSummary,
  validatePlacement,
  WEEKDAY_SHORT,
} from '@/lib/teacher/schedule-reference-utils';
import FreeTimePicker from './FreeTimePicker';
import { ScheduleDateSelect, ScheduleTimeField } from './SchedulePickers';
import { Shell } from './ScheduleLessonActionModals';

type Patch = (patch: (prev: TeacherCabinetData) => TeacherCabinetData) => void;
type Report = Dispatch<SetStateAction<ActionFeedback | null>>;

/* ---------- Карточка ученика: создание и редактирование ---------- */

export function RosterStudentModal({
  student,
  data,
  nowMs,
  busy,
  runAction,
  report,
  patchTeacher,
  onSchedule,
  onClose,
}: {
  student?: TeacherRosterStudent;
  data: TeacherCabinetData;
  nowMs: number;
  busy: boolean;
  runAction: StaffRunAction;
  report: Report;
  patchTeacher?: Patch;
  onSchedule?: (student: TeacherRosterStudent) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(student?.name ?? '');
  const [phone, setPhone] = useState(student?.phone ?? '');
  const [classLabel, setClassLabel] = useState(student?.classLabel ?? '');
  const [score, setScore] = useState(student?.initialScore != null ? String(student.initialScore) : '');
  const [notes, setNotes] = useState(student?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [cancelFutureOnArchive, setCancelFutureOnArchive] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteWithLessons, setDeleteWithLessons] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  const summary = student ? rosterLessonSummary(data.allLessons, student.id, nowMs) : null;
  const nameValid = name.trim().length > 0;

  const save = () => {
    if (!nameValid) {
      setFeedback({ type: 'error', message: 'Укажите имя ученика' });
      return;
    }
    setSaving(true);
    void runWithFeedback(
      runAction,
      setFeedback,
      async () => {
        const res = await fetch('/api/cabinet/teacher/roster', {
          method: student ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: student?.id,
            name,
            phone,
            classLabel,
            initialScore: score,
            notes,
          }),
        });
        const body = await readJson<{ error: string; student: TeacherRosterStudent }>(res);
        if (!res.ok || !body.student) {
          throw new Error(formatScheduleApiError(body.error, 'Не удалось сохранить ученика', res.status));
        }
        const saved = body.student;
        patchTeacher?.((prev) => upsertRosterStudent(prev, saved));
      },
      student ? 'Ученик сохранён' : 'Ученик добавлен',
      { refresh: 'none' },
    )
      .then((result) => {
        if (result?.type === 'success') {
          report(result);
          onClose();
        }
      })
      .finally(() => setSaving(false));
  };

  const archive = () => {
    if (!student) return;
    setSaving(true);
    void runWithFeedback(
      runAction,
      setFeedback,
      async () => {
        const res = await fetch('/api/cabinet/teacher/roster/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: student.id,
            cancelFutureLessons: cancelFutureOnArchive && (summary?.upcoming ?? 0) > 0,
          }),
        });
        const body = await readJson<{
          error: string;
          student: TeacherRosterStudent;
          cancelledLessonIds?: number[];
        }>(res);
        const saved = body.student;
        if (!res.ok || !saved) {
          throw new Error(formatScheduleApiError(body.error, 'Не удалось архивировать ученика', res.status));
        }
        patchTeacher?.((prev) => {
          let next = setRosterArchiveState(prev, saved, true);
          const cancelled = body.cancelledLessonIds ?? [];
          if (cancelled.length > 0) {
            next = cancelLessonsByIds(next, cancelled, 'Архив ученика');
          }
          return next;
        });
      },
      'Ученик в архиве',
      { refresh: 'none' },
    )
      .then((result) => {
        if (result?.type === 'success') {
          report(result);
          onClose();
        }
      })
      .finally(() => setSaving(false));
  };

  const restore = async (archived: TeacherRosterStudent) => {
    setSaving(true);
    try {
      const res = await fetch('/api/cabinet/teacher/roster/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: archived.id, restore: true }),
      });
      const body = await readJson<{ error: string; student: TeacherRosterStudent }>(res);
      const saved = body.student;
      if (!res.ok || !saved) {
        throw new Error(formatScheduleApiError(body.error, 'Не удалось восстановить ученика', res.status));
      }
      patchTeacher?.((prev) => setRosterArchiveState(prev, saved, false));
      report({ type: 'success', message: 'Ученик восстановлен' });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Не удалось восстановить',
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteStudent = () => {
    if (!student) return;
    setSaving(true);
    void runWithFeedback(
      runAction,
      setFeedback,
      async () => {
        const qs = new URLSearchParams({ id: String(student.id) });
        if (deleteWithLessons) qs.set('withLessons', '1');
        const res = await fetch(`/api/cabinet/teacher/roster?${qs}`, { method: 'DELETE' });
        const body = await readJson<{ error: string; removedLessonIds?: number[] }>(res);
        if (!res.ok) {
          throw new Error(formatScheduleApiError(body.error, 'Не удалось удалить ученика', res.status));
        }
        patchTeacher?.((prev) =>
          removeRosterStudentCompletely(prev, student.id, body.removedLessonIds ?? []),
        );
      },
      'Ученик удалён',
      { refresh: 'none' },
    )
      .then((result) => {
        if (result?.type === 'success') {
          report(result);
          onClose();
        }
      })
      .finally(() => setSaving(false));
  };

  const archivedList = data.archivedRoster ?? [];

  return (
    <Shell
      title={student ? student.name : 'Новый ученик'}
      subtitle={
        student
          ? summary && summary.upcoming > 0
            ? `Занятий впереди: ${summary.upcoming}${summary.slots ? ` · ${summary.slots}` : ''}`
            : 'Занятий в расписании нет'
          : 'Добавьте ученика, чтобы выбирать его при составлении расписания'
      }
      onClose={onClose}
      footer={
        <>
          {student ? (
            confirmDelete ? (
              <div className="sr-modal-foot-left sr-confirm">
                <span>Удалить ученика без возможности восстановления?</span>
                {summary && summary.upcoming > 0 ? (
                  <label className="sr-check">
                    <input
                      type="checkbox"
                      checked={deleteWithLessons}
                      onChange={(e) => setDeleteWithLessons(e.target.checked)}
                    />
                    <span>Удалить также {summary.upcoming} будущих занятий</span>
                  </label>
                ) : null}
                <button type="button" className="sr-btn sr-btn--danger" disabled={saving || busy} onClick={deleteStudent}>
                  Удалить
                </button>
                <button type="button" className="sr-btn sr-btn--ghost" onClick={() => setConfirmDelete(false)}>
                  Нет
                </button>
              </div>
            ) : confirmArchive ? (
              <div className="sr-modal-foot-left sr-confirm">
                <span>Архивировать ученика?</span>
                {summary && summary.upcoming > 0 ? (
                  <label className="sr-check">
                    <input
                      type="checkbox"
                      checked={cancelFutureOnArchive}
                      onChange={(e) => setCancelFutureOnArchive(e.target.checked)}
                    />
                    <span>Отменить {summary.upcoming} будущих занятий в календаре</span>
                  </label>
                ) : null}
                <button type="button" className="sr-btn sr-btn--danger" disabled={saving || busy} onClick={archive}>
                  Архивировать
                </button>
                <button type="button" className="sr-btn sr-btn--ghost" onClick={() => setConfirmArchive(false)}>
                  Нет
                </button>
              </div>
            ) : (
              <div className="sr-modal-foot-left sr-foot-actions">
                {onSchedule ? (
                  <button type="button" className="sr-btn sr-btn--ghost" onClick={() => onSchedule(student)}>
                    Добавить в расписание
                  </button>
                ) : null}
                <button type="button" className="sr-btn sr-btn--ghost" onClick={() => setConfirmArchive(true)}>
                  Архивировать
                </button>
                <button type="button" className="sr-btn sr-btn--ghost" onClick={() => setConfirmDelete(true)}>
                  Удалить
                </button>
              </div>
            )
          ) : null}
          <button type="button" className="sr-btn sr-btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="sr-btn sr-btn--primary"
            disabled={saving || busy || !nameValid}
            onClick={save}
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </>
      }
    >
      <label className="sr-field">
        <span>Имя</span>
        <input type="text" value={name} placeholder="Имя и фамилия" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="sr-field-row">
        <label className="sr-field">
          <span>Телефон</span>
          <input type="text" value={phone} placeholder="+375…" onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="sr-field">
          <span>Класс</span>
          <input type="text" value={classLabel} placeholder="Например, 9" onChange={(e) => setClassLabel(e.target.value)} />
        </label>
        <label className="sr-field">
          <span>Начальная оценка</span>
          <input type="text" inputMode="decimal" value={score} placeholder="—" onChange={(e) => setScore(e.target.value)} />
        </label>
      </div>
      <label className="sr-field">
        <span>Заметка</span>
        <textarea value={notes} rows={2} placeholder="Необязательно" onChange={(e) => setNotes(e.target.value)} />
      </label>
      {!student && archivedList.length > 0 ? (
        <div className="sr-field">
          <button type="button" className="sr-link" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Скрыть архив' : `Архив (${archivedList.length})`}
          </button>
          {showArchived ? (
            <ul className="sr-student-list sr-student-list--compact">
              {archivedList.map((item) => (
                <li key={item.id}>
                  <span className="sr-student-text">
                    <strong>{item.name}</strong>
                  </span>
                  <button
                    type="button"
                    className="sr-btn sr-btn--ghost sr-btn--sm"
                    disabled={saving || busy}
                    onClick={() => void restore(item)}
                  >
                    Восстановить
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <CabinetFeedback feedback={feedback} />
    </Shell>
  );
}

/* ---------- Постоянное расписание ученика ---------- */

const WEEK_OPTIONS = [4, 8, 12, 24];
const WEEKDAYS_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const DEFAULT_DAY_TIME = '16:00';
const DEFAULT_DAY_DURATION_MIN = 60;

function defaultEndForStart(start: string): string {
  return minutesToTime(Math.min(timeToMinutes(start) + DEFAULT_DAY_DURATION_MIN, 24 * 60 - 1));
}

function nextDateForWeekday(from: string, weekday: number): Date {
  const [y, m, d] = from.split('-').map(Number);
  const base = new Date(y, (m || 1) - 1, d || 1);
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    if (weekdayIndex(day) === weekday) return day;
  }
  return base;
}

export function RosterScheduleModal({
  student,
  data,
  events,
  busy,
  runAction,
  report,
  patchTeacher,
  onClose,
}: {
  student: TeacherRosterStudent;
  data: TeacherCabinetData;
  events: ScheduleEvent[];
  busy: boolean;
  runAction: StaffRunAction;
  report: Report;
  patchTeacher?: Patch;
  onClose: () => void;
}) {
  const [todayKey] = useState(() => dateKey(new Date()));
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [timeByWeekday, setTimeByWeekday] = useState<Partial<Record<number, string>>>({});
  const [endTimeByWeekday, setEndTimeByWeekday] = useState<Partial<Record<number, string>>>({});
  const [expandedWeekday, setExpandedWeekday] = useState<number | null>(null);
  const [fromDate, setFromDate] = useState(todayKey);
  const [weeks, setWeeks] = useState(SERIES_DEFAULT_WEEKS);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  const durationForWeekday = (index: number): number => {
    const start = timeByWeekday[index] ?? DEFAULT_DAY_TIME;
    const end = endTimeByWeekday[index] ?? defaultEndForStart(start);
    return durationFromRange(start, end);
  };

  const setWeekdayTime = (index: number, time: string) => {
    setTimeByWeekday((prev) => ({ ...prev, [index]: time }));
    setEndTimeByWeekday((prev) => {
      const end = prev[index] ?? defaultEndForStart(time);
      if (timeToMinutes(end) <= timeToMinutes(time)) {
        return { ...prev, [index]: defaultEndForStart(time) };
      }
      return prev[index] ? prev : { ...prev, [index]: end };
    });
  };

  const setWeekdayEndTime = (index: number, time: string) => {
    setEndTimeByWeekday((prev) => ({ ...prev, [index]: time }));
  };

  const toggleWeekday = (index: number) => {
    setWeekdays((prev) => {
      if (prev.includes(index)) {
        const next = prev.filter((v) => v !== index);
        setExpandedWeekday((cur) => (cur === index ? null : cur));
        setTimeByWeekday((times) => {
          const copy = { ...times };
          delete copy[index];
          return copy;
        });
        setEndTimeByWeekday((times) => {
          const copy = { ...times };
          delete copy[index];
          return copy;
        });
        return next;
      }
      const start = DEFAULT_DAY_TIME;
      setTimeByWeekday((times) => ({
        ...times,
        [index]: times[index] ?? start,
      }));
      setEndTimeByWeekday((times) => ({
        ...times,
        [index]: times[index] ?? defaultEndForStart(start),
      }));
      return [...prev, index].sort((a, b) => a - b);
    });
  };

  const occurrences = useMemo(
    () =>
      weekdays.length > 0
        ? buildSeriesOccurrences({ fromDate, weekdays, weekdayTimes: timeByWeekday, weeks })
        : [],
    [fromDate, weekdays, timeByWeekday, weeks],
  );

  const conflicts = useMemo(
    () =>
      occurrences.filter((startsAt) => {
        const day = dateKey(new Date(startsAt));
        const startTime = isoToTimeLabel(startsAt);
        const wd = weekdayIndex(new Date(startsAt));
        const endTime = endTimeByWeekday[wd] ?? defaultEndForStart(startTime);
        return (
          validatePlacement({
            slotDate: day,
            startTime,
            endTime,
            events,
            daySlots: data.daySlots,
            workingHours: data.workingHours,
          }) != null
        );
      }).length,
    [occurrences, endTimeByWeekday, events, data.daySlots, data.workingHours],
  );

  const timeValid = weekdays.every((wd) => {
    const start = timeByWeekday[wd];
    const end = endTimeByWeekday[wd];
    if (!start || !end) return false;
    return timeToMinutes(end) > timeToMinutes(start);
  });
  const canSubmit = occurrences.length > 0 && timeValid && !busy;

  const submit = () => {
    if (!canSubmit) return;
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
            occurrences.map((occStartsAt) => {
              const wd = weekdayIndex(new Date(occStartsAt));
              return createOptimisticLesson({
                id: tempIdByStartsAt.get(occStartsAt)!,
                kind: 'individual',
                startsAt: occStartsAt,
                durationMinutes: durationForWeekday(wd),
                topic: 'Индивидуальное занятие',
                studentName: student.name,
                scheduleStudentId: student.id,
              });
            }),
          ),
        );
      },
      request: async () => {
        const slots = occurrences.map((startsAt) => ({
          startsAt,
          durationMinutes: durationForWeekday(weekdayIndex(new Date(startsAt))),
        }));
        const res = await fetch('/api/cabinet/teacher/schedule/series', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'individual',
            scheduleStudentId: student.id,
            slots,
          }),
        });
        const body = await readJson<{
          error: string;
          seriesId: string;
          lessons: { id: number; startsAt: string }[];
          skipped: { startsAt: string; reason: string }[];
        }>(res);
        if (!res.ok) {
          patchTeacher?.((prev) => removeTeacherLessons(prev, tempIds));
          throw new Error(formatScheduleApiError(body.error, 'Не удалось создать расписание', res.status));
        }
        const created = body.lessons ?? [];
        patchTeacher?.((prev) => reconcileSeriesLessons(prev, tempIdByStartsAt, created, body.seriesId));
        const skipped = body.skipped ?? [];
        if (skipped.length === 0) return undefined;
        const list = skipped
          .slice(0, 3)
          .map((item) => `${dateKey(new Date(item.startsAt)).slice(5).split('-').reverse().join('.')} — ${item.reason}`)
          .join('; ');
        return `Создано: ${created.length}. Пропущено: ${skipped.length} (${list}${skipped.length > 3 ? '…' : ''})`;
      },
    });
  };

  return (
    <Shell
      title="Добавить в расписание"
      subtitle={`${student.name} — постоянные дни и время, каждую неделю`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sr-btn sr-btn--ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="sr-btn sr-btn--primary" disabled={!canSubmit} onClick={submit}>
            Зарезервировать
          </button>
        </>
      }
      wide
    >
      <div className="sr-field">
        <span>Дни недели</span>
        <div className="sr-chips">
          {WEEKDAY_SHORT.map((label, index) => (
            <button
              key={label}
              type="button"
              className={`sr-chip${weekdays.includes(index) ? ' is-active' : ''}`}
              onClick={() => toggleWeekday(index)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="sr-field">
        <span>С даты</span>
        <ScheduleDateSelect value={fromDate} minKey={todayKey} onChange={setFromDate} />
      </label>

      {weekdays.length > 0 ? (
        <div className="sr-field">
          <span>Время по дням</span>
          <ul className="sr-day-time-list">
            {[...weekdays].sort((a, b) => a - b).map((index) => {
              const start = timeByWeekday[index] ?? DEFAULT_DAY_TIME;
              const end = endTimeByWeekday[index] ?? defaultEndForStart(start);
              const timelineDay = nextDateForWeekday(fromDate, index);
              const expanded = expandedWeekday === index;
              return (
                <li key={index} className={`sr-day-time-item${expanded ? ' is-expanded' : ''}`}>
                  <div className="sr-day-time-head">
                    <span className="sr-day-time-label">{WEEKDAYS_FULL[index]}</span>
                    <span className="sr-day-time-summary">
                      {start}–{end}
                    </span>
                    <button
                      type="button"
                      className="sr-btn sr-btn--ghost sr-day-time-toggle"
                      onClick={() => setExpandedWeekday(expanded ? null : index)}
                    >
                      {expanded ? 'Свернуть' : 'Настроить время'}
                    </button>
                  </div>
                  {expanded ? (
                    <div className="sr-day-time-card">
                      <p className="sr-day-time-timeline-label">
                        Свободное время ·{' '}
                        {timelineDay.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                      </p>
                      <FreeTimePicker
                        day={timelineDay}
                        events={events}
                        daySlots={data.daySlots}
                        workingHours={data.workingHours}
                        durationMinutes={durationForWeekday(index)}
                        startTime={start}
                        onPick={(time) => setWeekdayTime(index, time)}
                      />
                      <div className="sr-field-row">
                        <label className="sr-field">
                          <span>Начало</span>
                          <ScheduleTimeField
                            value={start}
                            onChange={(time) => setWeekdayTime(index, time)}
                            aria-label={`${WEEKDAYS_FULL[index]}: начало`}
                          />
                        </label>
                        <label className="sr-field">
                          <span>Конец</span>
                          <ScheduleTimeField
                            value={end}
                            onChange={(time) => setWeekdayEndTime(index, time)}
                            aria-label={`${WEEKDAYS_FULL[index]}: конец`}
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="sr-field">
        <span>Повторять недель</span>
        <div className="sr-chips">
          {WEEK_OPTIONS.map((count) => (
            <button
              key={count}
              type="button"
              className={`sr-chip${weeks === count ? ' is-active' : ''}`}
              onClick={() => setWeeks(count)}
            >
              {count}
            </button>
          ))}
        </div>
      </div>

      <p className="sr-modal-hint">
        {weekdays.length === 0
          ? 'Выберите хотя бы один день недели.'
          : `Будет создано занятий: ${occurrences.length - conflicts}${
              conflicts > 0 ? `, ${conflicts} дат заняты или вне рабочего времени — будут пропущены` : ''
            }. Каждое занятие можно перенести отдельно.`}
      </p>
      <CabinetFeedback feedback={feedback} />
    </Shell>
  );
}

export function RosterListModal({
  data,
  nowMs,
  onClose,
  onOpenStudent,
  onAddStudent,
}: {
  data: TeacherCabinetData;
  nowMs: number;
  onClose: () => void;
  onOpenStudent: (student: TeacherRosterStudent) => void;
  onAddStudent?: () => void;
}) {
  const [query, setQuery] = useState('');
  const roster = data.roster ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.phone ?? '').includes(q) ||
        (s.classLabel ?? '').toLowerCase().includes(q),
    );
  }, [roster, query]);

  return (
    <Shell
      title="Мои ученики"
      subtitle={`${roster.length} в активном списке`}
      wide
      onClose={onClose}
      footer={
        <>
          {onAddStudent ? (
            <button type="button" className="sr-btn sr-btn--ghost" onClick={onAddStudent}>
              Добавить ученика
            </button>
          ) : null}
          <button type="button" className="sr-btn sr-btn--primary" onClick={onClose}>
            Закрыть
          </button>
        </>
      }
    >
      <input
        type="text"
        className="sr-roster-search"
        value={query}
        placeholder="Поиск: имя, телефон, класс"
        aria-label="Поиск ученика"
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      {filtered.length === 0 ? (
        <p className="sr-muted sr-roster-empty">{query.trim() ? 'Никого не найдено' : 'Список пуст'}</p>
      ) : (
        <ul className="sr-roster-list">
          {filtered.map((student) => {
            const info = rosterLessonSummary(data.allLessons, student.id, nowMs);
            const meta = [student.classLabel ? `${student.classLabel} кл.` : null, student.phone]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={student.id}>
                <button type="button" className="sr-roster-row" onClick={() => onOpenStudent(student)}>
                  <span className={`sr-avatar sr-avatar--${student.id % 4}`}>{initialsOf(student.name)}</span>
                  <span className="sr-roster-main">
                    <strong>{student.name}</strong>
                    {meta ? <span>{meta}</span> : null}
                  </span>
                  <span className={`sr-roster-slots${info.slots ? '' : ' is-empty'}`}>
                    {info.slots || 'нет занятий'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}

