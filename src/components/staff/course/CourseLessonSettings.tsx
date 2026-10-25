'use client';

import { useState } from 'react';
import type { CuratorCabinetData, CuratorLessonView } from '@/lib/curator/cabinet-data';
import type { ActionFeedback, StaffRunAction } from '@/lib/staff/run-action';
import { runWithKeyedFeedback } from '@/lib/staff/action-feedback';
import CabinetFeedback from '@/components/ui/CabinetFeedback';
import {
  CABINET_UPLOAD_MAX_BYTES,
  cabinetUploadTooLargeMessage,
  readApiErrorMessage,
} from '@/lib/api/read-error';
import {
  curatorLessonDisplayNo,
  formatDateTime,
  sessionLabel,
  sessionPillClass,
  toDatetimeLocal,
} from '@/components/curator/curator-utils';
import { IconCalendarRef, IconClockRef, IconXRef } from '../schedule/ScheduleRefIcons';
import { lessonFullDate, lessonTime } from './course-utils';

type FileField = 'lessonMaterials' | 'lessonHomeworkFiles';

type Props = {
  data: CuratorCabinetData;
  lesson: CuratorLessonView;
  /** drawer — выезжающая панель справа; page — экран настройки в центре. */
  variant: 'drawer' | 'page';
  /** Крестик показывается только в drawer. */
  onClose?: () => void;
  busy: boolean;
  runAction: StaffRunAction;
};

function FileSection({
  title,
  area,
  files,
  writeEnabled,
  busy,
  feedback,
  onUpload,
  onToggle,
  onDelete,
}: {
  title: string;
  area: string;
  files: CuratorLessonView['materials'];
  writeEnabled: boolean;
  busy: boolean;
  feedback?: ActionFeedback | null;
  onUpload: (file: File) => void;
  onToggle: (index: number, published: boolean) => void;
  onDelete: (index: number, fileName: string | null) => void;
}) {
  return (
    <section className={`cr-card cr-side-card ${area}`}>
      <div className="cr-side-card-head">
        <h3 className="cr-h3">{title}</h3>
        <span className="cr-muted">{files.length}</span>
      </div>
      {files.length === 0 ? <p className="cr-muted">Файлов пока нет.</p> : null}
      <ul className="cr-file-list">
        {files.map((file) => (
          <li key={`${file.index}-${file.fileName}`} className="cr-file">
            <div className="cr-file-main">
              <strong className="cr-file-name">{file.fileName ?? 'Файл'}</strong>
              <span className={`cr-file-state${file.published ? ' is-on' : ''}`}>
                {file.published ? 'Опубликован' : 'Скрыт'}
              </span>
            </div>
            <div className="cr-file-actions">
              {file.fileUrl ? (
                <a href={file.fileUrl} target="_blank" rel="noreferrer" className="cr-link">
                  Открыть
                </a>
              ) : null}
              {writeEnabled ? (
                <>
                  <button
                    type="button"
                    className="cr-link"
                    disabled={busy}
                    onClick={() => onToggle(file.index, !file.published)}
                  >
                    {file.published ? 'Скрыть' : 'Опубликовать'}
                  </button>
                  <button
                    type="button"
                    className="cr-link cr-link--danger"
                    disabled={busy}
                    onClick={() => onDelete(file.index, file.fileName)}
                  >
                    Удалить
                  </button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {writeEnabled ? (
        <label className="cr-upload">
          <span className="cr-btn cr-btn--ghost cr-btn--sm">+ Загрузить файл</span>
          <small className="cr-muted">до {Math.floor(CABINET_UPLOAD_MAX_BYTES / (1024 * 1024))} МБ</small>
          <input
            type="file"
            hidden
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = '';
            }}
          />
        </label>
      ) : null}
      <CabinetFeedback feedback={feedback} />
    </section>
  );
}

function LessonSettings({
  lesson,
  total,
  writeEnabled,
  busy,
  onClose,
  runAction,
}: {
  lesson: CuratorLessonView;
  total: number;
  writeEnabled: boolean;
  busy: boolean;
  onClose?: () => void;
  runAction: StaffRunAction;
}) {
  const [liveUrl, setLiveUrl] = useState(lesson.liveUrl ?? '');
  const [recordingUrl, setRecordingUrl] = useState(lesson.recordingUrl ?? '');
  const [scheduledAt, setScheduledAt] = useState(toDatetimeLocal(lesson.scheduledAt));
  const [feedbacks, setFeedbacks] = useState<Record<string, ActionFeedback>>({});

  const base = `/api/cabinet/curator/lessons/${encodeURIComponent(lesson.sanityId)}`;

  const saveFields = () =>
    void runWithKeyedFeedback(
      runAction,
      setFeedbacks,
      'save',
      async () => {
        const res = await fetch(base, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            liveUrl: liveUrl.trim() || null,
            recordingUrl: recordingUrl.trim() || null,
            scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
            lessonDate: scheduledAt ? scheduledAt.slice(0, 10) : null,
          }),
        });
        if (!res.ok) throw new Error(await readApiErrorMessage(res, 'Не удалось сохранить'));
      },
      'Занятие сохранено',
    );

  const sessionAction = (action: 'start' | 'end') =>
    void runWithKeyedFeedback(
      runAction,
      setFeedbacks,
      'session',
      async () => {
        const res = await fetch(`${base}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const body = (await res.json()) as {
          error?: string;
          notify?: { message?: string; sent?: number };
        };
        if (!res.ok) throw new Error(body.error ?? 'Не удалось обновить статус');
        if (action === 'start' && body.notify) {
          if ((body.notify.sent ?? 0) === 0) {
            throw new Error(body.notify.message ?? 'Уведомления не отправлены');
          }
          return body.notify.message ?? 'Эфир начался — ученики видят трансляцию';
        }
      },
      action === 'start'
        ? lesson.sessionStatus === 'completed'
          ? 'Эфир снова запущен — ученики видят трансляцию'
          : 'Эфир начался — ученики видят трансляцию'
        : 'Занятие завершено',
    );

  const notify = (type: 'materials' | 'recording') =>
    void runWithKeyedFeedback(runAction, setFeedbacks, `notify-${type}`, async () => {
      const res = await fetch(`${base}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const body = (await res.json()) as { error?: string; message?: string; sent?: number };
      if (!res.ok) throw new Error(body.error ?? 'Не удалось отправить уведомления');
      if ((body.sent ?? 0) === 0) throw new Error(body.message ?? 'Никому не отправлено');
      return body.message ?? 'Уведомления отправлены в Telegram';
    });

  const uploadFile = (field: FileField, file: File) =>
    void runWithKeyedFeedback(
      runAction,
      setFeedbacks,
      field,
      async () => {
        if (file.size > CABINET_UPLOAD_MAX_BYTES) throw new Error(cabinetUploadTooLargeMessage());
        const form = new FormData();
        form.set('field', field);
        form.set('file', file);
        const res = await fetch(`${base}/files`, { method: 'POST', body: form });
        if (!res.ok) throw new Error(await readApiErrorMessage(res, 'Не удалось загрузить файл'));
      },
      'Файл загружен',
    );

  const togglePublished = (field: FileField, index: number, published: boolean) =>
    void runWithKeyedFeedback(
      runAction,
      setFeedbacks,
      `${field}-${index}`,
      async () => {
        const res = await fetch(`${base}/files`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field, index, published }),
        });
        if (!res.ok) throw new Error(await readApiErrorMessage(res, 'Не удалось обновить файл'));
      },
      published ? 'Файл опубликован' : 'Публикация снята',
    );

  const deleteFile = (field: FileField, index: number, fileName: string | null) => {
    const label = fileName ?? 'файл';
    if (!window.confirm(`Удалить «${label}» с занятия? Это действие нельзя отменить.`)) return;
    void runWithKeyedFeedback(
      runAction,
      setFeedbacks,
      `delete-${field}-${index}`,
      async () => {
        const params = new URLSearchParams({ field, index: String(index) });
        const res = await fetch(`${base}/files?${params}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(await readApiErrorMessage(res, 'Не удалось удалить файл'));
      },
      'Файл удалён',
    );
  };

  const canStart = lesson.sessionStatus !== 'live';
  const canEnd = lesson.sessionStatus === 'live';
  const isRestart = lesson.sessionStatus === 'completed';

  return (
    <>
      <section className="cr-card cr-side-card cr-side-hero cr-area-hero">
        <div className="cr-side-top">
          <h2 className="cr-h2">Занятие курса</h2>
          <span className="cr-chip-static">
            Урок {curatorLessonDisplayNo(lesson)} из {total}
          </span>
          {onClose ? (
            <button type="button" className="cr-icon-btn" onClick={onClose} aria-label="Закрыть занятие">
              <IconXRef size={14} />
            </button>
          ) : null}
        </div>
        <h3 className="cr-side-title">{lesson.title}</h3>
        {lesson.moduleTitle ? <p className="cr-muted">{lesson.moduleTitle}</p> : null}
        <div className="cr-meta-row">
          <span className="cr-meta">
            <IconCalendarRef size={14} />
            {lessonFullDate(lesson.scheduledAt)}
          </span>
          <span className="cr-meta">
            <IconClockRef size={14} />
            {lessonTime(lesson.scheduledAt)}
          </span>
        </div>
        <span className={`cr-pill ${sessionPillClass(lesson.sessionStatus)}`}>
          {sessionLabel(lesson.sessionStatus)}
        </span>
        <div className="cr-side-actions">
          <button
            type="button"
            className="cr-btn cr-btn--primary"
            disabled={busy || !canStart || !writeEnabled}
            onClick={() => sessionAction('start')}
          >
            {isRestart ? 'Начать снова' : 'Начать занятие'}
          </button>
          <button
            type="button"
            className="cr-btn cr-btn--outline"
            disabled={busy || !canEnd}
            onClick={() => sessionAction('end')}
          >
            Завершить занятие
          </button>
        </div>
        {lesson.startedAt ? (
          <p className="cr-muted">Эфир начат: {formatDateTime(lesson.startedAt)}</p>
        ) : null}
        {lesson.endedAt ? <p className="cr-muted">Завершено: {formatDateTime(lesson.endedAt)}</p> : null}
        <CabinetFeedback feedback={feedbacks.session} />
      </section>

      <section className="cr-card cr-side-card cr-area-links">
        <h3 className="cr-h3">Дата и ссылки</h3>
        <label className="cr-field">
          <span>Дата и время эфира</span>
          <input
            type="datetime-local"
            value={scheduledAt}
            disabled={!writeEnabled || busy}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </label>
        <label className="cr-field">
          <span>Ссылка на трансляцию</span>
          <input
            type="url"
            value={liveUrl}
            disabled={!writeEnabled || busy}
            onChange={(e) => setLiveUrl(e.target.value)}
            placeholder="https://youtube.com/live/..."
          />
        </label>
        <label className="cr-field">
          <span>Ссылка на запись</span>
          <input
            type="url"
            value={recordingUrl}
            disabled={!writeEnabled || busy}
            onChange={(e) => setRecordingUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
          />
        </label>
        {writeEnabled ? (
          <button type="button" className="cr-btn cr-btn--ghost" disabled={busy} onClick={saveFields}>
            Сохранить
          </button>
        ) : null}
        <CabinetFeedback feedback={feedbacks.save} />
      </section>

      <FileSection
        title="Материалы занятия"
        area="cr-area-mats"
        files={lesson.materials}
        writeEnabled={writeEnabled}
        busy={busy}
        feedback={feedbacks.lessonMaterials}
        onUpload={(file) => uploadFile('lessonMaterials', file)}
        onToggle={(index, published) => togglePublished('lessonMaterials', index, published)}
        onDelete={(index, name) => deleteFile('lessonMaterials', index, name)}
      />
      <FileSection
        title="Домашнее задание"
        area="cr-area-hw"
        files={lesson.homeworkFiles}
        writeEnabled={writeEnabled}
        busy={busy}
        feedback={feedbacks.lessonHomeworkFiles}
        onUpload={(file) => uploadFile('lessonHomeworkFiles', file)}
        onToggle={(index, published) => togglePublished('lessonHomeworkFiles', index, published)}
        onDelete={(index, name) => deleteFile('lessonHomeworkFiles', index, name)}
      />

      <section className="cr-card cr-side-card cr-area-notify">
        <div className="cr-notify-text">
          <h3 className="cr-h3">Уведомления в Telegram</h3>
          <p className="cr-notify-desc">Рассылка ученикам с доступом к занятию.</p>
        </div>
        <div className="cr-side-actions">
          <button type="button" className="cr-btn cr-btn--ghost" disabled={busy} onClick={() => notify('materials')}>
            Материалы опубликованы
          </button>
          <button type="button" className="cr-btn cr-btn--ghost" disabled={busy} onClick={() => notify('recording')}>
            Запись готова
          </button>
        </div>
        <CabinetFeedback feedback={feedbacks['notify-materials']} />
        <CabinetFeedback feedback={feedbacks['notify-recording']} />
      </section>
    </>
  );
}

export default function CourseLessonSettings({ data, lesson, variant, onClose, busy, runAction }: Props) {
  return (
    <div className={`cr-settings cr-settings--${variant}`}>
      <LessonSettings
        key={lesson.sanityId}
        lesson={lesson}
        total={data.lessons.length}
        writeEnabled={data.sanityWriteEnabled}
        busy={busy}
        onClose={variant === 'drawer' ? onClose : undefined}
        runAction={runAction}
      />
    </div>
  );
}
