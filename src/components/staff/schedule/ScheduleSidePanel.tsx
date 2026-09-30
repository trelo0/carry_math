'use client';

import { useEffect, useMemo, useState } from 'react';
import { sessionLabel } from '@/components/curator/curator-utils';
import type { CourseLessonDetailView } from '@/lib/curator/lesson-detail';
import type { TeacherCabinetData, TeacherDaySlot, TeacherLessonView } from '@/lib/teacher/cabinet-data';
import { buildOrdinaryDetailFromEvent } from '@/lib/teacher/lesson-detail-from-event';
import { isLessonInLiveWindow } from '@/lib/teacher/lesson-utils';
import type {
  TeacherLessonDetailView,
  TeacherLessonHomeworkView,
  TeacherLessonMaterialView,
} from '@/lib/teacher/lesson-detail';
import { homeworkReviewStatusLabel } from '@/lib/lesson-homework';
import { patchTeacherLesson } from '@/lib/teacher/schedule-optimistic';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runWithFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';
import { CANCEL_REASONS } from '@/lib/teacher/schedule-types';
import { formatScheduleApiError } from '@/lib/teacher/schedule-api-errors';
import {
  addDays,
  buildLocalIso,
  dateKey,
  durationFromRange,
  formatDayTitle,
  formatLessonDateTimeLine,
  freeSlotsForDay,
  isoToTimeLabel,
  kindBadgeLabel,
  minutesToTime,
  statusLabel,
  timeToMinutes,
  validateLessonPlacementClient,
} from '@/lib/teacher/schedule-utils';

type Props = {
  event: ScheduleEvent;
  teacherData?: TeacherCabinetData;
  patchTeacher?: (patch: (prev: TeacherCabinetData) => TeacherCabinetData) => void;
  busy: boolean;
  startedLessonIds: ReadonlySet<number>;
  daySlots: TeacherDaySlot[];
  allEvents: ScheduleEvent[];
  onClose: () => void;
  onOpenCourseLesson?: (sanityId: string) => void;
  onStartLesson?: (lesson: TeacherLessonView) => void;
  onLessonFinished?: (lessonId: number) => void;
  onOpenStudent?: (telegramId: number) => void;
  onOpenGroup?: (groupId: number) => void;
  onPlanReplacementLesson?: (draft: {
    date: Date;
    startTime: string;
    endTime: string;
    kind: 'individual' | 'group';
    studentTelegramId?: number | null;
    groupId?: number | null;
    replacesLessonId?: number;
  }) => void;
  runAction: StaffRunAction;
};

function ExternalLinkRow({ label, href }: { label: string; href: string }) {
  return (
    <a href={href} className="sched-lesson-ext-link" target="_blank" rel="noopener noreferrer">
      <span>{label}</span>
      <span aria-hidden>↗</span>
    </a>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: 'scheduled' | 'live' | 'completed' | 'cancelled' | 'course';
}) {
  return (
    <p className={`sched-lesson-status sched-lesson-status--${tone}`}>
      <span className="sched-lesson-status-dot" aria-hidden />
      {label}
    </p>
  );
}

export default function ScheduleSidePanel({
  event,
  teacherData,
  patchTeacher,
  busy,
  startedLessonIds,
  daySlots,
  allEvents,
  onClose,
  onOpenCourseLesson,
  onStartLesson,
  onLessonFinished,
  onOpenStudent,
  onOpenGroup,
  onPlanReplacementLesson,
  runAction,
}: Props) {
  const isCourse = event.kind === 'course';
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel'>('view');
  const [error, setError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [materialFeedback, setMaterialFeedback] = useState<ActionFeedback | null>(null);
  const [homeworkFeedback, setHomeworkFeedback] = useState<ActionFeedback | null>(null);
  const [materials, setMaterials] = useState<TeacherLessonMaterialView[]>([]);
  const [homework, setHomework] = useState<TeacherLessonHomeworkView | null>(null);
  const [hwInstruction, setHwInstruction] = useState('');
  const [hwDue, setHwDue] = useState('');
  const [hwReviewComment, setHwReviewComment] = useState('');
  const [courseDetail, setCourseDetail] = useState<CourseLessonDetailView | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(dateKey(new Date(event.startsAt)));
  const [rescheduleStart, setRescheduleStart] = useState(isoToTimeLabel(event.startsAt));
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('teacher');
  const [cancelNote, setCancelNote] = useState('');
  const [confirmStartOpen, setConfirmStartOpen] = useState(false);
  const [meetUrl, setMeetUrl] = useState(event.meetUrl ?? '');
  const [boardUrl, setBoardUrl] = useState(event.boardUrl ?? '');

  const ordinaryDetail = useMemo(
    () => (isCourse ? null : buildOrdinaryDetailFromEvent(event, teacherData, materials)),
    [event, isCourse, teacherData, materials],
  );

  const activeStatus = ordinaryDetail?.status ?? event.status;
  const courseSessionStatus = courseDetail?.sessionStatus;
  const sessionStarted = Boolean(event.lessonId && startedLessonIds.has(event.lessonId));
  const isOrdinaryLive = Boolean(
    ordinaryDetail &&
      activeStatus === 'scheduled' &&
      (sessionStarted ||
        isLessonInLiveWindow({
          status: ordinaryDetail.status,
          startsAt: ordinaryDetail.startsAt,
          durationMinutes: ordinaryDetail.durationMinutes,
        })),
  );
  const isCourseLive = courseSessionStatus === 'live';
  const canManageOrdinary = Boolean(ordinaryDetail && activeStatus === 'scheduled' && !isOrdinaryLive);
  const canEditOrdinaryCard = Boolean(
    ordinaryDetail && (activeStatus === 'scheduled' || isOrdinaryLive),
  );
  const canEditCourse =
    courseSessionStatus === 'scheduled' ||
    courseSessionStatus === 'waiting' ||
    courseSessionStatus === 'live';

  useEffect(() => {
    setMode('view');
    setConfirmStartOpen(false);
    setActionFeedback(null);
    setError(null);
    setMeetUrl(event.meetUrl ?? '');
    setBoardUrl(event.boardUrl ?? '');
  }, [event.id, event.startsAt, event.endsAt, event.status, event.meetUrl, event.boardUrl]);

  useEffect(() => {
    if (isCourse || !event.lessonId) {
      setMaterials([]);
      setHomework(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/cabinet/teacher/lessons/${event.lessonId}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const detail = (await res.json()) as TeacherLessonDetailView;
        if (cancelled) return;
        setMaterials(detail.materials ?? []);
        setHomework(detail.homework ?? null);
        setHwInstruction(detail.homework?.instructionText ?? '');
        setHwDue(detail.homework?.dueAt ? detail.homework.dueAt.slice(0, 16) : '');
        setMeetUrl(detail.meetUrl ?? '');
        setBoardUrl(detail.boardUrl ?? '');
      } catch {
        /* фоновая подгрузка */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [event.lessonId, isCourse]);

  useEffect(() => {
    if (!isCourse || !event.sanityLessonId) {
      setCourseDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/cabinet/curator/lessons/${encodeURIComponent(event.sanityLessonId!)}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          if (!cancelled) {
            const body = (await res.json()) as { error?: string };
            setError(body.error ?? 'Не удалось открыть занятие');
          }
          return;
        }
        const detail = (await res.json()) as CourseLessonDetailView;
        if (!cancelled) {
          setCourseDetail(detail);
          setMeetUrl(detail.liveUrl ?? '');
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Не удалось открыть занятие');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [event.sanityLessonId, isCourse]);

  useEffect(() => {
    setSelectedSlotId(null);
  }, [rescheduleDate, mode]);

  const lessonDuration = ordinaryDetail?.durationMinutes ?? durationFromRange(isoToTimeLabel(event.startsAt), isoToTimeLabel(event.endsAt));

  const rescheduleEvents = useMemo(
    () => allEvents.filter((item) => item.lessonId !== event.lessonId),
    [allEvents, event.lessonId],
  );

  const rescheduleDay = useMemo(() => {
    const [y, m, d] = rescheduleDate.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, [rescheduleDate]);

  const availableRescheduleSlots = useMemo(() => {
    return freeSlotsForDay(daySlots, rescheduleDay, rescheduleEvents).filter(
      (slot) => durationFromRange(slot.startTime, slot.endTime) >= lessonDuration,
    );
  }, [daySlots, rescheduleDay, rescheduleEvents, lessonDuration]);

  const selectedSlot = availableRescheduleSlots.find((slot) => slot.id === selectedSlotId) ?? null;

  const submitReschedule = () => {
    if (isCourse && event.sanityLessonId) {
      const startsAt = buildLocalIso(rescheduleDate, rescheduleStart);
      void runWithFeedback(
        runAction,
        setActionFeedback,
        async () => {
          const res = await fetch(`/api/cabinet/curator/lessons/${event.sanityLessonId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scheduledAt: startsAt }),
          });
          if (!res.ok) {
            const body = (await res.json()) as { error?: string };
            throw new Error(formatScheduleApiError(body.error, 'Не удалось перенести', res.status));
          }
          setMode('view');
        },
        'Вебинар перенесён',
        { refresh: 'full' },
      );
      return;
    }

    if (!event.lessonId || !selectedSlot) return;
    const startsAt = buildLocalIso(selectedSlot.slotDate, selectedSlot.startTime);
    const lessonEndTime = minutesToTime(timeToMinutes(selectedSlot.startTime) + lessonDuration);
    const placementError = validateLessonPlacementClient({
      slotDate: selectedSlot.slotDate,
      startTime: selectedSlot.startTime,
      endTime: lessonEndTime,
      events: allEvents,
      daySlots,
      excludeLessonId: event.lessonId,
    });
    if (placementError) {
      setActionFeedback({ type: 'error', message: placementError });
      return;
    }

    const lessonId = event.lessonId;
    patchTeacher?.((prev) => patchTeacherLesson(prev, lessonId, { startsAt }));
    setMode('view');
    void runWithFeedback(runAction, setActionFeedback, async () => {
      const res = await fetch(`/api/cabinet/teacher/lessons/${lessonId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startsAt,
          durationMinutes: lessonDuration,
        }),
      });
      if (!res.ok) {
        patchTeacher?.((prev) =>
          patchTeacherLesson(prev, lessonId, {
            startsAt: event.startsAt,
          }),
        );
        const body = (await res.json()) as { error?: string };
        throw new Error(formatScheduleApiError(body.error, 'Не удалось перенести', res.status));
      }
    }, 'Занятие перенесено');
  };

  const submitCancel = () => {
    const reasonLabel = CANCEL_REASONS.find((r) => r.id === cancelReason)?.label ?? cancelReason;
    const reasonText = cancelNote.trim() ? `${reasonLabel}: ${cancelNote.trim()}` : reasonLabel;

    if (!event.lessonId) return;
    if (activeStatus !== 'scheduled') {
      setActionFeedback({
        type: 'error',
        message: 'Отменить можно только запланированное занятие',
      });
      return;
    }
    const lessonId = event.lessonId;
    void runWithFeedback(runAction, setActionFeedback, async () => {
      const res = await fetch(`/api/cabinet/teacher/lessons/${lessonId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason, reasonNote: reasonText }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(formatScheduleApiError(body.error, 'Не удалось отменить', res.status));
      }
      patchTeacher?.((prev) => patchTeacherLesson(prev, lessonId, { status: 'cancelled', cancelReason: reasonText }));
      onLessonFinished?.(lessonId);
      setMode('view');
    }, 'Занятие отменено');
  };

  const planReplacementLesson = () => {
    if (!ordinaryDetail || !onPlanReplacementLesson || !event.lessonId) return;
    const lessonId = event.lessonId;
    const start = new Date(event.startsAt);
    const end = new Date(event.endsAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    onPlanReplacementLesson({
      date: start,
      startTime: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
      endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
      kind: ordinaryDetail.kind === 'group' ? 'group' : 'individual',
      studentTelegramId: ordinaryDetail.student?.telegramId ?? null,
      groupId: ordinaryDetail.group?.id ?? null,
      replacesLessonId: lessonId,
    });
  };

  const saveLinks = () => {
    if (!event.lessonId) return;
    const lessonId = event.lessonId;
    const nextMeet = meetUrl.trim() || null;
    const nextBoard = boardUrl.trim() || null;
    const prevMeet = ordinaryDetail?.meetUrl ?? null;
    const prevBoard = ordinaryDetail?.boardUrl ?? null;
    patchTeacher?.((prev) => patchTeacherLesson(prev, lessonId, { meetUrl: nextMeet, boardUrl: nextBoard }));
    void runWithFeedback(
      runAction,
      setActionFeedback,
      async () => {
        const res = await fetch(`/api/cabinet/teacher/lessons/${lessonId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ meetUrl: nextMeet, boardUrl: nextBoard }),
        });
        if (!res.ok) {
          patchTeacher?.((prev) =>
            patchTeacherLesson(prev, lessonId, { meetUrl: prevMeet, boardUrl: prevBoard }),
          );
          const body = (await res.json()) as { error?: string };
          throw new Error(formatScheduleApiError(body.error, 'Не удалось сохранить', res.status));
        }
      },
      'Ссылки сохранены',
      { refresh: 'none' },
    );
  };

  const uploadMaterial = (file: File) => {
    if (!event.lessonId) return;
    const tempId = -Date.now();
    const optimistic = { id: tempId, fileName: file.name, fileSize: file.size ? String(file.size) : null };
    setMaterials((prev) => [...prev, optimistic]);
    void runWithFeedback(
      runAction,
      setMaterialFeedback,
      async () => {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`/api/cabinet/teacher/lessons/${event.lessonId}/materials`, {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          setMaterials((prev) => prev.filter((item) => item.id !== tempId));
          const body = (await res.json()) as { error?: string };
          throw new Error(formatScheduleApiError(body.error, 'Не удалось загрузить файл', res.status));
        }
        const created = (await res.json()) as TeacherLessonMaterialView;
        setMaterials((prev) => prev.map((item) => (item.id === tempId ? created : item)));
      },
      'Файл загружен',
      { refresh: 'none' },
    );
  };

  const deleteMaterial = (materialId: number) => {
    if (!event.lessonId) return;
    const snapshot = materials;
    setMaterials((prev) => prev.filter((item) => item.id !== materialId));
    void runWithFeedback(
      runAction,
      setMaterialFeedback,
      async () => {
        const res = await fetch(
          `/api/cabinet/teacher/lessons/${event.lessonId}/materials?materialId=${materialId}`,
          { method: 'DELETE' },
        );
        if (!res.ok) {
          setMaterials(snapshot);
          const body = (await res.json()) as { error?: string };
          throw new Error(formatScheduleApiError(body.error, 'Не удалось удалить файл', res.status));
        }
      },
      'Файл удалён',
      { refresh: 'none' },
    );
  };

  const completeLesson = () => {
    if (!event.lessonId) return;
    if (activeStatus !== 'scheduled' && !isOrdinaryLive) {
      setActionFeedback({
        type: 'error',
        message: 'Завершить можно только идущее или запланированное занятие',
      });
      return;
    }
    const lessonId = event.lessonId;
    patchTeacher?.((prev) => patchTeacherLesson(prev, lessonId, { status: 'completed' }));
    onLessonFinished?.(lessonId);
    void runWithFeedback(
      runAction,
      setActionFeedback,
      async () => {
        const res = await fetch(`/api/cabinet/teacher/lessons/${lessonId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        });
        if (!res.ok) {
          patchTeacher?.((prev) => patchTeacherLesson(prev, lessonId, { status: 'scheduled' }));
          const body = (await res.json()) as { error?: string };
          throw new Error(formatScheduleApiError(body.error, 'Не удалось завершить', res.status));
        }
      },
      'Занятие завершено',
    );
  };

  const sessionAction = (action: 'start' | 'end') => {
    if (!event.sanityLessonId) return;
    void runWithFeedback(
      runAction,
      setActionFeedback,
      async () => {
        const res = await fetch(`/api/cabinet/curator/lessons/${encodeURIComponent(event.sanityLessonId!)}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const body = (await res.json()) as { error?: string; notify?: { message?: string; sent?: number } };
        if (!res.ok) {
          throw new Error(formatScheduleApiError(body.error, 'Не удалось обновить статус', res.status));
        }
        if (action === 'start' && body.notify && (body.notify.sent ?? 0) === 0) {
          throw new Error(body.notify.message ?? 'Уведомления не отправлены');
        }
      },
      action === 'start' ? 'Эфир начался' : 'Занятие завершено',
      { refresh: 'full' },
    );
  };

  const lessonSource = event.sourceLesson;
  const confirmStartLesson = () => {
    if (lessonSource && onStartLesson) onStartLesson(lessonSource);
    setConfirmStartOpen(false);
  };

  const participantStartLabel =
    ordinaryDetail?.kind === 'individual' && ordinaryDetail.student
      ? ordinaryDetail.student.name ?? `ID ${ordinaryDetail.student.telegramId}`
      : ordinaryDetail?.kind === 'group' && ordinaryDetail.group
        ? ordinaryDetail.group.title
        : event.participantLabel ?? 'Занятие';

  const topicLabel = (ordinaryDetail?.topic ?? event.title).trim();
  const showTopic = !isCourse && topicLabel.length > 0;
  const meetHref = meetUrl.trim() || null;
  const boardHref = boardUrl.trim() || null;
  const linksDirty =
    meetUrl.trim() !== (ordinaryDetail?.meetUrl ?? '').trim() ||
    boardUrl.trim() !== (ordinaryDetail?.boardUrl ?? '').trim();
  const todayKey = dateKey(new Date());
  const canShiftRescheduleBack = rescheduleDate > todayKey;

  const shiftRescheduleDay = (delta: number) => {
    const next = addDays(rescheduleDay, delta);
    const key = dateKey(next);
    if (delta < 0 && key < todayKey) return;
    setRescheduleDate(key);
  };

  const renderCoursePrimaryAction = () => {
    if (!courseDetail) return null;
    if (courseSessionStatus === 'live') {
      return meetUrl.trim() ? (
        <a href={meetUrl.trim()} className="sched-btn sched-btn--primary sched-lesson-cta" target="_blank" rel="noopener noreferrer">
          Открыть занятие
        </a>
      ) : (
        <button type="button" className="sched-btn sched-btn--primary sched-lesson-cta" disabled>
          Открыть занятие
        </button>
      );
    }
    if (courseSessionStatus === 'scheduled' || courseSessionStatus === 'waiting') {
      return (
        <button type="button" className="sched-btn sched-btn--primary sched-lesson-cta" disabled={busy} onClick={() => sessionAction('start')}>
          Начать занятие
        </button>
      );
    }
    return null;
  };

  const renderOrdinaryActions = () => {
    if (!ordinaryDetail) return null;

    if (activeStatus === 'cancelled') {
      return (
        <div className="sched-lesson-cancelled-block">
          <StatusBadge label="ЗАНЯТИЕ ОТМЕНЕНО" tone="cancelled" />
          {ordinaryDetail.cancelReason ? (
            <p className="sched-lesson-muted sched-lesson-cancelled-reason">{ordinaryDetail.cancelReason}</p>
          ) : null}
          <p className="sched-lesson-muted">Это время снова свободно — можно поставить новое занятие.</p>
          {onPlanReplacementLesson ? (
            <button type="button" className="sched-btn sched-btn--primary sched-lesson-cta" disabled={busy} onClick={planReplacementLesson}>
              Добавить занятие на это время
            </button>
          ) : null}
        </div>
      );
    }

    if (activeStatus === 'completed') {
      return (
        <div className="sched-lesson-done">
          <StatusBadge label="ЗАНЯТИЕ ЗАВЕРШЕНО" tone="completed" />
          <p className="sched-lesson-done-line">Выполнено</p>
          <p className="sched-lesson-done-line">Занятие списано</p>
        </div>
      );
    }

    if (isOrdinaryLive) {
      return (
        <div className="sched-lesson-live-block">
          <StatusBadge label="ЗАНЯТИЕ ИДЁТ" tone="live" />
          <button type="button" className="sched-btn sched-btn--primary sched-lesson-cta" disabled={busy} onClick={completeLesson}>
            Завершить занятие
          </button>
        </div>
      );
    }

    if (canManageOrdinary) {
      return (
        <div className="sched-lesson-actions">
          <button type="button" className="sched-btn sched-btn--primary sched-lesson-cta" disabled={busy} onClick={() => setConfirmStartOpen(true)}>
            Начать занятие
          </button>
          <button type="button" className="sched-btn sched-btn--ghost sched-lesson-action" disabled={busy} onClick={() => setMode('reschedule')}>
            Перенести занятие
          </button>
          <button type="button" className="sched-btn sched-btn--ghost sched-lesson-action sched-lesson-action--danger" disabled={busy} onClick={() => setMode('cancel')}>
            Отменить занятие
          </button>
        </div>
      );
    }

    return <StatusBadge label={statusLabel(activeStatus).toUpperCase()} tone="scheduled" />;
  };

  const renderCourseStatus = () => {
    if (!courseDetail) return null;
    if (isCourseLive) return <StatusBadge label="ЗАНЯТИЕ ИДЁТ" tone="live" />;
    return (
      <StatusBadge
        label={sessionLabel(courseSessionStatus ?? 'scheduled').toUpperCase()}
        tone={courseSessionStatus === 'completed' ? 'completed' : 'course'}
      />
    );
  };

  const renderConnectionSection = () => {
    if (isCourse) return null;

    if (canEditOrdinaryCard) {
      return (
        <div className="sched-lesson-section">
          <h3 className="sched-lesson-section-label">Подключение</h3>
          <div className="sched-lesson-fields">
            <label className="sched-lesson-field">
              <span>Ссылка на конференцию</span>
              <input
                type="url"
                value={meetUrl}
                onChange={(e) => setMeetUrl(e.target.value)}
                placeholder="https://..."
                disabled={busy}
              />
            </label>
            <label className="sched-lesson-field">
              <span>Ссылка на доску</span>
              <input
                type="url"
                value={boardUrl}
                onChange={(e) => setBoardUrl(e.target.value)}
                placeholder="https://..."
                disabled={busy}
              />
            </label>
            {linksDirty ? (
              <button type="button" className="sched-btn sched-btn--ghost sched-btn--sm" disabled={busy} onClick={saveLinks}>
                Сохранить ссылки
              </button>
            ) : null}
            {(meetHref || boardHref) && !linksDirty ? (
              <div className="sched-lesson-links">
                {meetHref ? <ExternalLinkRow label="Открыть конференцию" href={meetHref} /> : null}
                {boardHref ? <ExternalLinkRow label="Открыть доску" href={boardHref} /> : null}
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    if (!meetHref && !boardHref) return null;

    return (
      <div className="sched-lesson-section">
        <h3 className="sched-lesson-section-label">Подключение</h3>
        <div className="sched-lesson-links">
          {meetHref ? <ExternalLinkRow label="Открыть конференцию" href={meetHref} /> : null}
          {boardHref ? <ExternalLinkRow label="Открыть доску" href={boardHref} /> : null}
        </div>
      </div>
    );
  };

  const uploadHomework = (file: File) => {
    if (!event.lessonId) return;
    void runWithFeedback(
      runAction,
      setHomeworkFeedback,
      async () => {
        const form = new FormData();
        form.append('file', file);
        form.append('instructionText', hwInstruction);
        if (hwDue.trim()) form.append('dueAt', new Date(hwDue).toISOString());
        const res = await fetch(`/api/cabinet/teacher/lessons/${event.lessonId}/homework`, {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(formatScheduleApiError(body.error, 'Не удалось сохранить ДЗ', res.status));
        }
        const created = (await res.json()) as TeacherLessonHomeworkView;
        setHomework(created);
      },
      'Домашнее задание сохранено',
      { refresh: 'none' },
    );
  };

  const reviewHomework = (action: 'approve' | 'revision') => {
    if (!event.lessonId) return;
    void runWithFeedback(
      runAction,
      setHomeworkFeedback,
      async () => {
        const res = await fetch(`/api/cabinet/teacher/lessons/${event.lessonId}/homework/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, comment: hwReviewComment }),
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(formatScheduleApiError(body.error, 'Не удалось обновить статус', res.status));
        }
        const updated = (await res.json()) as TeacherLessonHomeworkView;
        setHomework(updated);
        setHwReviewComment('');
      },
      action === 'approve' ? 'Работа принята' : 'Отправлено на доработку',
      { refresh: 'none' },
    );
  };

  const renderHomeworkSection = () => {
    if (isCourse || !ordinaryDetail || !event.lessonId) return null;
    const canEdit = canEditOrdinaryCard;
    const onReview =
      homework && (homework.reviewStatus === 'submitted' || homework.reviewStatus === 'reviewing');

    return (
      <div className="sched-lesson-section">
        <h3 className="sched-lesson-section-label">Домашнее задание</h3>
        {homework ? (
          <div className="sched-lesson-files">
            <p className="sched-lesson-muted">
              {homework.fileName} · {homeworkReviewStatusLabel(homework.reviewStatus)}
            </p>
            {homework.submittedAt ? (
              <p className="sched-lesson-muted">
                Сдано: {new Date(homework.submittedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' })}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="sched-lesson-muted">Задание не выдано</p>
        )}

        {canEdit ? (
          <>
            <label className="sched-lesson-field">
              <span>Условие (текст)</span>
              <textarea value={hwInstruction} onChange={(e) => setHwInstruction(e.target.value)} rows={3} />
            </label>
            <label className="sched-lesson-field">
              <span>Срок сдачи</span>
              <input type="datetime-local" value={hwDue} onChange={(e) => setHwDue(e.target.value)} />
            </label>
            <label className="sched-lesson-upload">
              <span className="sched-btn sched-btn--ghost sched-btn--sm">
                {homework ? 'Заменить файл задания' : '+ Загрузить файл задания'}
              </span>
              <input
                type="file"
                hidden
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadHomework(file);
                  e.target.value = '';
                }}
              />
            </label>
          </>
        ) : null}

        {onReview && canEdit ? (
          <div className="sched-lesson-secondary-actions">
            <label className="sched-lesson-field">
              <span>Комментарий</span>
              <textarea value={hwReviewComment} onChange={(e) => setHwReviewComment(e.target.value)} rows={2} />
            </label>
            <button type="button" className="sched-btn sched-btn--primary" disabled={busy} onClick={() => reviewHomework('approve')}>
              Принять
            </button>
            <button type="button" className="sched-btn sched-btn--ghost" disabled={busy} onClick={() => reviewHomework('revision')}>
              На доработку
            </button>
          </div>
        ) : null}
        <CabinetFeedback feedback={homeworkFeedback} />
      </div>
    );
  };

  const renderMaterialsSection = () => {
    if (isCourse || !ordinaryDetail || !event.lessonId) return null;
    const materials = ordinaryDetail.materials ?? [];
    const canEdit = canEditOrdinaryCard;

    return (
      <div className="sched-lesson-section">
        <h3 className="sched-lesson-section-label">Материалы</h3>
        <div className="sched-lesson-files">
          {materials.length === 0 && !canEdit ? <p className="sched-lesson-muted">Файлов нет</p> : null}
          {materials.length === 0 && canEdit ? <p className="sched-lesson-muted">Файлов пока нет</p> : null}
          {materials.length > 0 ? (
            <ul className="sched-lesson-file-list">
              {materials.map((file) => (
                <li key={file.id} className="sched-lesson-file-row">
                  <a
                    href={`/api/cabinet/teacher/lessons/${event.lessonId}/materials/${file.id}`}
                    className="sched-lesson-file-name"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {file.fileName}
                  </a>
                  {canEdit ? (
                    <button type="button" className="sched-lesson-file-remove" disabled={busy} onClick={() => deleteMaterial(file.id)}>
                      Удалить
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {canEdit ? (
            <label className="sched-lesson-upload">
              <span className="sched-btn sched-btn--ghost sched-btn--sm">+ Загрузить файл</span>
              <input
                type="file"
                hidden
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadMaterial(file);
                  e.target.value = '';
                }}
              />
            </label>
          ) : null}
          <CabinetFeedback feedback={materialFeedback} />
        </div>
      </div>
    );
  };

  return (
    <>
    <aside className="sched-aside sched-lesson-detail">
      <section className="sched-aside-block">
        <button type="button" className="sched-lesson-back" onClick={onClose}>
          ← К дню
        </button>

        {error ? (
          <div className="schedule-detail-error">
            <p>{error}</p>
          </div>
        ) : null}

        {mode === 'reschedule' ? (
          <div className="schedule-side-form">
            <h3 className="sched-lesson-form-title">{isCourse ? 'Перенос вебинара' : 'Перенос занятия'}</h3>
            <div className="sched-lesson-field">
              <span>День</span>
              <div className="sched-date-nav sched-date-nav--compact">
                <button
                  type="button"
                  className="sched-icon-btn"
                  disabled={!canShiftRescheduleBack}
                  onClick={() => shiftRescheduleDay(-1)}
                  aria-label="Предыдущий день"
                >
                  ←
                </button>
                <span className="sched-date-pill sched-date-pill--compact">{formatDayTitle(rescheduleDay)}</span>
                <button
                  type="button"
                  className="sched-icon-btn"
                  onClick={() => shiftRescheduleDay(1)}
                  aria-label="Следующий день"
                >
                  →
                </button>
              </div>
            </div>

            {isCourse ? (
              <label className="sched-lesson-field">
                <span>Начало</span>
                <input
                  type="time"
                  className="sched-time-input"
                  value={rescheduleStart}
                  onChange={(e) => setRescheduleStart(e.target.value)}
                />
              </label>
            ) : (
              <div className="sched-reschedule-slots">
                <p className="sched-lesson-section-label">Свободные слоты</p>
                {availableRescheduleSlots.length === 0 ? (
                  <p className="sched-lesson-muted">На этот день нет подходящих свободных слотов</p>
                ) : (
                  <div className="sched-reschedule-slot-list">
                    {availableRescheduleSlots.map((slot) => (
                      <button
                        key={slot.id}
                        type="button"
                        className={`sched-reschedule-slot${selectedSlotId === slot.id ? ' is-selected' : ''}`}
                        onClick={() => setSelectedSlotId(slot.id)}
                      >
                        {slot.startTime} – {slot.endTime}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="sched-lesson-secondary-actions">
              <button
                type="button"
                className="sched-btn sched-btn--primary"
                disabled={busy || (!isCourse && !selectedSlot)}
                onClick={submitReschedule}
              >
                {selectedSlot
                  ? `Перенести на ${formatLessonDateTimeLine(
                      buildLocalIso(selectedSlot.slotDate, selectedSlot.startTime),
                      buildLocalIso(selectedSlot.slotDate, selectedSlot.endTime),
                    )}`
                  : 'Перенести'}
              </button>
              <button type="button" className="sched-btn sched-btn--ghost" onClick={() => setMode('view')}>
                Назад
              </button>
            </div>
            <CabinetFeedback feedback={actionFeedback} />
          </div>
        ) : null}

        {mode === 'cancel' ? (
          <div className="schedule-side-form schedule-cancel-form">
            <h3 className="sched-lesson-form-title">Отмена занятия</h3>
            <p className="sched-lesson-section-label">Причина отмены</p>
            <div className="schedule-cancel-reasons" role="radiogroup" aria-label="Причина отмены">
              {CANCEL_REASONS.map((reason) => (
                <label
                  key={reason.id}
                  className={`schedule-cancel-reason${cancelReason === reason.id ? ' is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="cancel-reason"
                    value={reason.id}
                    checked={cancelReason === reason.id}
                    onChange={() => setCancelReason(reason.id)}
                  />
                  <span>{reason.label}</span>
                </label>
              ))}
            </div>
            {cancelReason === 'other' ? (
              <label className="sched-lesson-field">
                <span>Комментарий</span>
                <textarea value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} rows={3} />
              </label>
            ) : null}
            <div className="sched-lesson-secondary-actions">
              <button type="button" className="sched-btn sched-btn--primary" disabled={busy} onClick={submitCancel}>
                Подтвердить отмену
              </button>
              <button type="button" className="sched-btn sched-btn--ghost" onClick={() => setMode('view')}>
                Назад
              </button>
            </div>
            <CabinetFeedback feedback={actionFeedback} />
          </div>
        ) : null}

        {mode === 'view' && !error ? (
          <>
            <span className={`sched-lesson-kind sched-lesson-kind--${event.kind}`}>{kindBadgeLabel(event.kind)}</span>

            {showTopic ? (
              <div className="sched-lesson-section">
                <h3 className="sched-lesson-section-label">Тема</h3>
                <p className="sched-lesson-section-main">{topicLabel}</p>
              </div>
            ) : null}

            <p className="sched-lesson-datetime">{formatLessonDateTimeLine(event.startsAt, event.endsAt)}</p>

            {isCourse ? (
              <>
                <h2 className="sched-lesson-title">{courseDetail?.title ?? event.title}</h2>
                {courseDetail ? <p className="sched-lesson-course-num">Урок {courseDetail.lessonNumber}</p> : null}
              </>
            ) : null}

            {ordinaryDetail?.kind === 'individual' && ordinaryDetail.student ? (
              <div className="sched-lesson-section">
                <h3 className="sched-lesson-section-label">Ученик</h3>
                <p className="sched-lesson-section-main">{ordinaryDetail.student.name ?? `ID ${ordinaryDetail.student.telegramId}`}</p>
                {onOpenStudent ? (
                  <button type="button" className="sched-lesson-profile-link" onClick={() => onOpenStudent(ordinaryDetail.student!.telegramId)}>
                    Открыть профиль →
                  </button>
                ) : null}
              </div>
            ) : null}

            {ordinaryDetail?.kind === 'individual' && !ordinaryDetail.student && event.participantLabel ? (
              <div className="sched-lesson-section">
                <h3 className="sched-lesson-section-label">Ученик</h3>
                <p className="sched-lesson-section-main">{event.participantLabel}</p>
              </div>
            ) : null}

            {ordinaryDetail?.kind === 'group' && ordinaryDetail.group ? (
              <div className="sched-lesson-section">
                <h3 className="sched-lesson-section-label">Группа</h3>
                <p className="sched-lesson-section-main">{ordinaryDetail.group.title}</p>
                <p className="sched-lesson-muted">{ordinaryDetail.group.members.length} учеников</p>
                {ordinaryDetail.group.members.length > 0 ? (
                  <p className="sched-lesson-members">
                    {ordinaryDetail.group.members
                      .map((member) => member.name ?? `ID ${member.telegramId}`)
                      .join(', ')}
                  </p>
                ) : null}
                {onOpenGroup ? (
                  <button type="button" className="sched-lesson-profile-link" onClick={() => onOpenGroup(ordinaryDetail.group!.id)}>
                    Открыть группу →
                  </button>
                ) : null}
              </div>
            ) : null}

            {activeStatus !== 'cancelled' ? renderConnectionSection() : null}
            {activeStatus !== 'cancelled' ? renderMaterialsSection() : null}
            {activeStatus !== 'cancelled' ? renderHomeworkSection() : null}

            {isCourse && courseDetail ? (
              <div className="sched-lesson-section">
                <h3 className="sched-lesson-section-label">Материалы</h3>
                <div className="sched-lesson-links">
                  {courseDetail.materials[0]?.fileUrl ? (
                    <ExternalLinkRow label="Презентация" href={courseDetail.materials[0].fileUrl} />
                  ) : null}
                  {courseDetail.homeworkFiles[0]?.fileUrl ? (
                    <ExternalLinkRow label="Домашнее задание" href={courseDetail.homeworkFiles[0].fileUrl} />
                  ) : null}
                  {courseDetail.recordingUrl ? (
                    <ExternalLinkRow label="Запись" href={courseDetail.recordingUrl} />
                  ) : courseDetail.materials[1]?.fileUrl ? (
                    <ExternalLinkRow label="Дополнительные материалы" href={courseDetail.materials[1].fileUrl} />
                  ) : null}
                </div>
              </div>
            ) : null}

            {isCourse ? (
              <>
                <div className="sched-lesson-section">{renderCourseStatus()}</div>
                {renderCoursePrimaryAction()}
                {(canEditCourse && courseDetail) || (isCourse && event.sanityLessonId && onOpenCourseLesson) ? (
                  <div className="sched-lesson-secondary-actions">
                    {isCourse && event.sanityLessonId && onOpenCourseLesson ? (
                      <button
                        type="button"
                        className="sched-btn sched-btn--ghost sched-btn--sm"
                        disabled={busy}
                        onClick={() => {
                          onOpenCourseLesson(event.sanityLessonId!);
                          onClose();
                        }}
                      >
                        Открыть в курсе
                      </button>
                    ) : null}
                    {canEditCourse && courseDetail ? (
                      <button type="button" className="sched-btn sched-btn--ghost sched-btn--sm" disabled={busy} onClick={() => setMode('reschedule')}>
                        Перенести
                      </button>
                    ) : null}
                    {isCourse && courseDetail?.sessionStatus === 'live' ? (
                      <button type="button" className="sched-btn sched-btn--ghost sched-btn--sm" disabled={busy} onClick={() => sessionAction('end')}>
                        Завершить эфир
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {canManageOrdinary && !isOrdinaryLive ? (
                  <div className="sched-lesson-section">
                    <StatusBadge label="ЗАПЛАНИРОВАНО" tone="scheduled" />
                  </div>
                ) : null}
                {activeStatus === 'cancelled' ? (
                  <div className="sched-lesson-section">{renderOrdinaryActions()}</div>
                ) : (
                  renderOrdinaryActions()
                )}
              </>
            )}

            <CabinetFeedback feedback={actionFeedback} />
          </>
        ) : null}
      </section>
    </aside>

    {confirmStartOpen ? (
      <div
        className="schedule-modal-overlay sched-start-confirm-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sched-start-confirm-title"
        onClick={() => setConfirmStartOpen(false)}
      >
        <div className="schedule-modal sched-start-confirm" onClick={(e) => e.stopPropagation()}>
          <h3 id="sched-start-confirm-title" className="sched-lesson-form-title">
            Начать занятие?
          </h3>
          <p className="sched-lesson-muted sched-start-confirm-when">
            {formatLessonDateTimeLine(event.startsAt, event.endsAt)}
          </p>
          <p className="sched-start-confirm-who">{participantStartLabel}</p>
          <div className="sched-start-confirm-actions">
            <button type="button" className="sched-btn sched-btn--primary" disabled={busy} onClick={confirmStartLesson}>
              Да, начать
            </button>
            <button type="button" className="sched-btn sched-btn--ghost" onClick={() => setConfirmStartOpen(false)}>
              Отмена
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
