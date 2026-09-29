'use client';

import { useState } from 'react';
import type { TeacherCabinetData } from '@/lib/teacher/cabinet-data';
import type { ScheduleFormKind } from '@/lib/teacher/schedule-types';
import { buildLocalIso, dateKey, durationFromRange } from '@/lib/teacher/schedule-utils';
import {
  addTeacherDaySlot,
  addTeacherLesson,
  createOptimisticLesson,
} from '@/lib/teacher/schedule-optimistic';
import type { TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runWithFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';

type Props = {
  data: TeacherCabinetData;
  initialDate?: Date;
  initialKind?: ScheduleFormKind;
  busy: boolean;
  patchTeacher?: (patch: (prev: TeacherCabinetData) => TeacherCabinetData) => void;
  onClose: () => void;
  runAction: StaffRunAction;
};

const TITLES: Record<ScheduleFormKind, string> = {
  individual: 'Добавить занятие',
  group: 'Групповое занятие',
  free: 'Свободный слот',
  break: 'Перерыв',
  busy: 'Занято',
};

export default function ScheduleAddModal({
  data,
  initialDate,
  initialKind = 'individual',
  busy,
  patchTeacher,
  onClose,
  runAction,
}: Props) {
  const [formKind, setFormKind] = useState<ScheduleFormKind>(initialKind);
  const [slotDate, setSlotDate] = useState(dateKey(initialDate ?? new Date()));
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [studentId, setStudentId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [topic, setTopic] = useState('');
  const [comment, setComment] = useState('');
  const [busyLabel, setBusyLabel] = useState('Занято');
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  const submit = () => {
    if (startTime >= endTime) {
      setFeedback({ type: 'error', message: 'Время окончания должно быть позже начала' });
      return;
    }

    if (formKind === 'free' || formKind === 'break' || formKind === 'busy') {
      const slotKind = formKind === 'free' ? 'extra' : formKind === 'break' ? 'break' : 'blocked';
      void runWithFeedback(runAction, setFeedback, async () => {
        const res = await fetch('/api/cabinet/teacher/day-slots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slotDate,
            startTime,
            endTime,
            slotKind,
            label: formKind === 'busy' ? busyLabel.trim() || 'Занято' : formKind === 'break' ? 'Перерыв' : null,
          }),
        });
        const body = (await res.json()) as { error?: string; slot?: TeacherDaySlot };
        if (!res.ok) {
          throw new Error(body.error ?? 'Не удалось сохранить');
        }
        if (body.slot) {
          patchTeacher?.((prev) => addTeacherDaySlot(prev, body.slot!));
        }
        onClose();
      }, 'Сохранено', { refresh: 'none' });
      return;
    }

    const startsAt = buildLocalIso(slotDate, startTime);

    const durationMinutes = durationFromRange(startTime, endTime);
    const student = formKind === 'individual' ? data.students.find((s) => s.telegramId === Number(studentId)) : undefined;
    const group = formKind === 'group' ? data.groups.find((g) => g.id === Number(groupId)) : undefined;

    void runWithFeedback(runAction, setFeedback, async () => {
      const payload: Record<string, unknown> = {
        kind: formKind,
        startsAt,
        endTime,
        topic: topic.trim() || undefined,
        lessonPlan: comment.trim() || undefined,
      };
      if (formKind === 'individual' && studentId) {
        payload.studentTelegramId = Number(studentId);
      }
      if (formKind === 'group' && groupId) {
        payload.groupId = Number(groupId);
      }

      const res = await fetch('/api/cabinet/teacher/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { error?: string; lessonId?: number; lessonIds?: number[] };
      if (!res.ok) {
        throw new Error(body.error ?? 'Не удалось создать занятие');
      }
      const lessonId = body.lessonId ?? body.lessonIds?.[0];
      if (lessonId && patchTeacher) {
        patchTeacher((prev) =>
          addTeacherLesson(
            prev,
            createOptimisticLesson({
              id: lessonId,
              kind: formKind as 'individual' | 'group',
              startsAt,
              durationMinutes,
              topic: topic.trim() || 'Занятие',
              studentTelegramId: student?.telegramId ?? null,
              studentName: student?.name ?? null,
              groupId: group?.id ?? null,
              groupTitle: group?.title ?? null,
              lessonPlan: comment.trim() || null,
            }),
          ),
        );
      }
      onClose();
    }, 'Занятие создано');
  };

  return (
    <div className="schedule-modal-overlay" role="dialog" aria-modal="true">
      <div className="schedule-modal sched-modal">
        <header className="schedule-modal-head">
          <h2>{TITLES[formKind]}</h2>
          <button type="button" className="sched-icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>

        <div className="schedule-modal-form">
          {formKind === 'individual' || formKind === 'group' ? (
            <div className="sched-modal-kind-switch">
              <button
                type="button"
                className={`sched-filter${formKind === 'individual' ? ' is-active' : ''}`}
                onClick={() => setFormKind('individual')}
              >
                Индивидуальное
              </button>
              <button
                type="button"
                className={`sched-filter${formKind === 'group' ? ' is-active' : ''}`}
                onClick={() => setFormKind('group')}
              >
                Групповое
              </button>
            </div>
          ) : null}

          <label>
            Дата
            <input type="date" value={slotDate} onChange={(e) => setSlotDate(e.target.value)} />
          </label>
          <div className="schedule-modal-row">
            <label>
              Начало
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </label>
            <label>
              Окончание
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </label>
          </div>

          {formKind === 'busy' ? (
            <label>
              Подпись
              <input
                type="text"
                value={busyLabel}
                onChange={(e) => setBusyLabel(e.target.value)}
                placeholder="Занято, встреча…"
              />
            </label>
          ) : null}

          {formKind === 'individual' ? (
            <>
              <label>
                Ученик <span className="sched-optional">(необязательно)</span>
                <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                  <option value="">Без ученика</option>
                  {data.students.map((s) => (
                    <option key={s.telegramId} value={s.telegramId}>
                      {s.name ?? s.telegramId}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Предмет / тема
                <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} />
              </label>
              <label>
                Комментарий
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Необязательно" />
              </label>
            </>
          ) : null}

          {formKind === 'group' ? (
            <>
              <label>
                Группа <span className="sched-optional">(необязательно)</span>
                <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  <option value="">Без группы</option>
                  {data.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Предмет / тема
                <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} />
              </label>
              <label>
                Комментарий
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Необязательно" />
              </label>
            </>
          ) : null}

          <CabinetFeedback feedback={feedback} />
          <button type="button" className="sched-btn sched-btn--primary" disabled={busy} onClick={submit}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
