'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminTeachersPanel from '@/components/admin/AdminTeachersPanel';
import TeacherSchedulePanel from '@/components/staff/schedule/TeacherSchedulePanel';
import CabinetFeedback from '@/components/ui/CabinetFeedback';
import type { AdminTeacherRow } from '@/lib/admin/schedule-data';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import type { TeacherCabinetData } from '@/lib/teacher/cabinet-data';
import type { ScheduleTeacherApiContext } from '@/lib/teacher/schedule-api-context';
import type { ScheduleEvent } from '@/lib/teacher/schedule-types';

const ADMIN_SCHEDULE_API_PREFIX = '/api/admin/schedule/teacher';
const SCHEDULE_PATH = '/cabinet/admin/schedule';

type Props = {
  selfId: number;
  selfName: string;
  teachers: AdminTeacherRow[];
  initialTeacherId: number;
  initialFocusLessonId?: number | null;
};

export default function AdminScheduleWorkspace({
  selfId,
  selfName,
  teachers,
  initialTeacherId,
  initialFocusLessonId = null,
}: Props) {
  // activeId — выбранный в блоке «Преподаватели»; loadedId — чьё расписание сейчас в календаре.
  const [activeId, setActiveId] = useState(initialTeacherId);
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const [teacherData, setTeacherData] = useState<TeacherCabinetData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [focusLessonId, setFocusLessonId] = useState<number | null>(initialFocusLessonId);

  const ownerId = loadedId ?? activeId;
  const scheduleApi: ScheduleTeacherApiContext = useMemo(
    () => ({ prefix: ADMIN_SCHEDULE_API_PREFIX, teacherTelegramId: ownerId }),
    [ownerId],
  );

  const fetchTeacher = useCallback(async (id: number) => {
    const res = await fetch(`${ADMIN_SCHEDULE_API_PREFIX}/data?teacherTelegramId=${id}`, {
      cache: 'no-store',
    });
    const body = (await res.json()) as TeacherCabinetData & { error?: string };
    if (!res.ok) throw new Error(body.error ?? 'Не удалось загрузить расписание');
    return body as TeacherCabinetData;
  }, []);

  // Меняется только календарь: прежний остаётся на экране, пока не придут новые данные.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetchTeacher(activeId)
      .then((data) => {
        if (cancelled) return;
        setTeacherData(data);
        setLoadedId(activeId);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Ошибка загрузки');
        // Откат выбора к тому, что реально показано.
        if (loadedId != null && loadedId !== activeId) setActiveId(loadedId);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, fetchTeacher]);

  const pickTeacher = useCallback(
    (id: number) => {
      if (id === activeId) return;
      setFeedback(null);
      setFocusLessonId(null);
      setActiveId(id);
      const url = id === selfId ? SCHEDULE_PATH : `${SCHEDULE_PATH}?teacher=${id}`;
      window.history.replaceState(null, '', url);
    },
    [activeId, selfId],
  );

  const patchTeacher = useCallback((patch: (prev: TeacherCabinetData) => TeacherCabinetData) => {
    setTeacherData((prev) => (prev ? patch(prev) : prev));
  }, []);

  const runAction: StaffRunAction = useCallback(
    async (action, successText, options) => {
      const silent = options?.silent === true;
      if (!silent) setBusy(true);
      try {
        const resultText = await action();
        if ((options?.refresh ?? 'full') !== 'none' && loadedId != null) {
          void fetchTeacher(loadedId)
            .then(setTeacherData)
            .catch(() => undefined);
        }
        const message = resultText ?? successText;
        return message ? { type: 'success', message } : null;
      } catch (error) {
        return {
          type: 'error',
          message: error instanceof Error ? error.message : 'Ошибка',
        };
      } finally {
        if (!silent) setBusy(false);
      }
    },
    [fetchTeacher, loadedId],
  );

  const togglePaid = useCallback(
    (event: ScheduleEvent, paid: boolean) => {
      const lessonId = event.lessonId;
      if (!lessonId) return;
      void runAction(async () => {
        const res = await fetch(`${ADMIN_SCHEDULE_API_PREFIX}/lessons/${lessonId}/paid`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paid }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? 'Не удалось сохранить отметку');
        return paid ? 'Занятие отмечено оплаченным' : 'Отметка об оплате снята';
      }).then((result) => setFeedback(result));
    },
    [runAction],
  );

  const ownerName =
    loadedId === selfId || loadedId == null
      ? selfName
      : (teachers.find((t) => t.telegramId === loadedId)?.fullName?.trim() ?? `ID ${loadedId}`);

  const error = feedback ?? (loadError ? ({ type: 'error', message: loadError } as ActionFeedback) : null);

  return (
    <div className="admin-schedule">
      {error ? (
        <div className="admin-schedule__feedback">
          <CabinetFeedback feedback={error} />
        </div>
      ) : null}
      <div className="staff-cabinet">
        <div
          className={`curator-main curator-main--schedule admin-schedule__host${loading ? ' is-loading' : ''}`}
          aria-busy={loading}
        >
          {loadedId != null && loadedId !== selfId ? (
            <p className="admin-schedule__owner">Расписание преподавателя: {ownerName}</p>
          ) : null}
          {teacherData ? (
            <TeacherSchedulePanel
              teacherData={teacherData}
              showCancelled
              scheduleApi={scheduleApi}
              focusLessonId={focusLessonId}
              onFocusLessonHandled={() => setFocusLessonId(null)}
              patchTeacher={patchTeacher}
              busy={busy || loading}
              runAction={runAction}
              onTogglePaid={togglePaid}
              statsBelow
              sidebarSlot={
                <AdminTeachersPanel
                  selfId={selfId}
                  teachers={teachers}
                  activeId={activeId}
                  loading={loading}
                  onPick={pickTeacher}
                />
              }
            />
          ) : (
            <p className="admin-panel__loading">
              {loading ? 'Загрузка расписания…' : 'Не удалось открыть расписание'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
