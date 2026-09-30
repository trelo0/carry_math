'use client';

import { useMemo, useState } from 'react';
import type { TeacherCabinetData, TeacherDaySlot } from '@/lib/teacher/cabinet-data';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import { formatScheduleApiError } from '@/lib/teacher/schedule-api-errors';
import {
  buildLocalIso,
  durationFromRange,
  formatTimeRange,
  validateLessonPlacementClient,
} from '@/lib/teacher/schedule-utils';
import {
  addTeacherLesson,
  createOptimisticLesson,
  removeTeacherDaySlot,
} from '@/lib/teacher/schedule-optimistic';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runWithFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';

type Props = {
  data: TeacherCabinetData;
  slot: TeacherDaySlot;
  events: ScheduleEvent[];
  daySlots: TeacherDaySlot[];
  busy: boolean;
  patchTeacher?: (patch: (prev: TeacherCabinetData) => TeacherCabinetData) => void;
  onClose: () => void;
  runAction: StaffRunAction;
};

function formatSlotDate(slotDate: string): string {
  const [y, m, d] = slotDate.split('-').map(Number);
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  return `${d} ${months[m - 1]} ${y}`;
}

export default function ScheduleLessonFromSlotModal({
  data,
  slot,
  events,
  daySlots,
  busy,
  patchTeacher,
  onClose,
  runAction,
}: Props) {
  const [kind, setKind] = useState<'individual' | 'group'>('individual');
  const [studentId, setStudentId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [topic, setTopic] = useState('');
  const [note, setNote] = useState('');
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  const whenLabel = useMemo(
    () => `${formatSlotDate(slot.slotDate)}, ${formatTimeRange(slot.startTime, slot.endTime)}`,
    [slot.slotDate, slot.startTime, slot.endTime],
  );

  const submit = () => {
    const placementError = validateLessonPlacementClient({
      slotDate: slot.slotDate,
      startTime: slot.startTime,
      endTime: slot.endTime,
      events,
      daySlots,
      fromSlotId: slot.id,
    });
    if (placementError) {
      setFeedback({ type: 'error', message: placementError });
      return;
    }

    const startsAt = buildLocalIso(slot.slotDate, slot.startTime);

    const durationMinutes = durationFromRange(slot.startTime, slot.endTime);
    const student = kind === 'individual' ? data.students.find((s) => s.telegramId === Number(studentId)) : undefined;
    const group = kind === 'group' ? data.groups.find((g) => g.id === Number(groupId)) : undefined;
    const slotId = slot.id;

    void runWithFeedback(runAction, setFeedback, async () => {
      const payload: Record<string, unknown> = {
        kind,
        startsAt,
        endTime: slot.endTime,
        topic: topic.trim() || undefined,
        lessonPlan: note.trim() || undefined,
        fromSlotId: slotId,
      };
      if (kind === 'individual' && studentId) {
        payload.studentTelegramId = Number(studentId);
      }
      if (kind === 'group' && groupId) {
        payload.groupId = Number(groupId);
      }

      const res = await fetch('/api/cabinet/teacher/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { error?: string; lessonId?: number; lessonIds?: number[] };
      if (!res.ok) {
        throw new Error(formatScheduleApiError(body.error, 'Не удалось создать занятие', res.status));
      }
      const lessonId = body.lessonId ?? body.lessonIds?.[0];
      if (lessonId && patchTeacher) {
        patchTeacher((prev) => {
          let next = removeTeacherDaySlot(prev, slotId);
          next = addTeacherLesson(
            next,
            createOptimisticLesson({
              id: lessonId,
              kind,
              startsAt,
              durationMinutes,
              topic: topic.trim() || 'Занятие',
              studentTelegramId: student?.telegramId ?? null,
              studentName: student?.name ?? null,
              groupId: group?.id ?? null,
              groupTitle: group?.title ?? null,
              lessonPlan: note.trim() || null,
            }),
          );
          return next;
        });
      }
      onClose();
    }, 'Занятие создано');
  };

  return (
    <div className="schedule-modal-overlay" role="dialog" aria-modal="true">
      <div className="schedule-modal sched-modal sched-modal--lesson">
        <header className="schedule-modal-head">
          <h2>Добавить занятие</h2>
          <button type="button" className="sched-icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>

        <div className="schedule-modal-form sched-lesson-form">
          <div className="sched-modal-kind-switch">
            <button
              type="button"
              className={`sched-filter${kind === 'individual' ? ' is-active' : ''}`}
              onClick={() => setKind('individual')}
            >
              Индивидуальное
            </button>
            <button
              type="button"
              className={`sched-filter${kind === 'group' ? ' is-active' : ''}`}
              onClick={() => setKind('group')}
            >
              Групповое
            </button>
          </div>

          <div className="sched-lesson-form-when">
            <span className="sched-lesson-form-when-label">Дата и время</span>
            <strong>{whenLabel}</strong>
          </div>

          {kind === 'individual' ? (
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
          ) : (
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
          )}

          <label>
            Тема
            <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Математика" />
          </label>

          <label>
            Заметка
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Необязательно"
            />
          </label>

          <CabinetFeedback feedback={feedback} />

          <div className="schedule-side-actions">
            <button type="button" className="sched-btn sched-btn--ghost" disabled={busy} onClick={onClose}>
              Отмена
            </button>
            <button type="button" className="sched-btn sched-btn--primary" disabled={busy} onClick={submit}>
              Создать занятие
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
