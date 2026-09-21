'use client';

import { useMemo, useState } from 'react';
import type { CuratorCabinetData, CuratorLessonView } from '@/lib/curator/cabinet-data';
import {
  formatDate,
  formatDateTime,
  sessionLabel,
  sessionPillClass,
  toDatetimeLocal,
} from './curator-utils';

type RunAction = (action: () => Promise<string | void>, successText?: string) => Promise<void>;

function FileBlock({
  title,
  files,
  writeEnabled,
  busy,
  onUpload,
  onToggle,
}: {
  title: string;
  files: CuratorLessonView['materials'];
  writeEnabled: boolean;
  busy: boolean;
  onUpload: (file: File) => void;
  onToggle: (index: number, published: boolean) => void;
}) {
  return (
    <section className="curator-card curator-card--files">
      <h2>{title}</h2>
      {files.length === 0 ? <p className="curator-muted">Файлов пока нет.</p> : null}
      <ul className="curator-file-list">
        {files.map((file) => (
          <li key={`${file.index}-${file.fileName}`} className="curator-file-row">
            <span>{file.published ? '✅' : '⬜'} {file.fileName ?? 'Файл'}</span>
            <span className="curator-file-actions">
              {file.fileUrl ? (
                <a href={file.fileUrl} target="_blank" rel="noreferrer" className="curator-link">
                  Открыть
                </a>
              ) : null}
              {writeEnabled ? (
                <button
                  type="button"
                  className="curator-link-btn"
                  disabled={busy}
                  onClick={() => onToggle(file.index, !file.published)}
                >
                  {file.published ? 'Снять' : 'Опубликовать'}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {writeEnabled ? (
        <label className="curator-upload">
          <span className="curator-btn curator-btn-ghost">+ Загрузить файл</span>
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
    </section>
  );
}

function LessonEditor({
  lesson,
  busy,
  writeEnabled,
  onBack,
  runAction,
}: {
  lesson: CuratorLessonView;
  busy: boolean;
  writeEnabled: boolean;
  onBack: () => void;
  runAction: RunAction;
}) {
  const [liveUrl, setLiveUrl] = useState(lesson.liveUrl ?? '');
  const [recordingUrl, setRecordingUrl] = useState(lesson.recordingUrl ?? '');
  const [scheduledAt, setScheduledAt] = useState(toDatetimeLocal(lesson.scheduledAt));

  const saveFields = () =>
    runAction(async () => {
      const res = await fetch(`/api/cabinet/curator/lessons/${encodeURIComponent(lesson.sanityId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          liveUrl: liveUrl.trim() || null,
          recordingUrl: recordingUrl.trim() || null,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          lessonDate: scheduledAt ? scheduledAt.slice(0, 10) : null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось сохранить');
      }
    }, 'Занятие сохранено');

  const sessionAction = (action: 'start' | 'end') =>
    runAction(async () => {
      const res = await fetch(
        `/api/cabinet/curator/lessons/${encodeURIComponent(lesson.sanityId)}/session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        notify?: { message?: string; sent?: number };
      };
      if (!res.ok) throw new Error(body.error ?? 'Не удалось обновить статус');
      if (action === 'start' && body.notify) {
        if ((body.notify.sent ?? 0) === 0) throw new Error(body.notify.message ?? 'Уведомления не отправлены');
        return body.notify.message ?? 'Эфир начался — ученики видят трансляцию';
      }
    }, action === 'start' ? 'Эфир начался — ученики видят трансляцию' : 'Занятие завершено');

  const notify = (type: 'materials' | 'recording') =>
    runAction(async () => {
      const res = await fetch(
        `/api/cabinet/curator/lessons/${encodeURIComponent(lesson.sanityId)}/notify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type }),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        message?: string;
        sent?: number;
      };
      if (!res.ok) throw new Error(body.error ?? 'Не удалось отправить уведомления');
      if ((body.sent ?? 0) === 0) throw new Error(body.message ?? 'Никому не отправлено');
      return body.message ?? 'Уведомления отправлены в Telegram';
    });

  const uploadFile = (field: 'lessonMaterials' | 'lessonHomeworkFiles', file: File) =>
    runAction(async () => {
      const form = new FormData();
      form.set('field', field);
      form.set('file', file);
      const res = await fetch(
        `/api/cabinet/curator/lessons/${encodeURIComponent(lesson.sanityId)}/files`,
        { method: 'POST', body: form },
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось загрузить файл');
      }
    }, 'Файл загружен');

  const togglePublished = (
    field: 'lessonMaterials' | 'lessonHomeworkFiles',
    index: number,
    published: boolean,
  ) =>
    runAction(async () => {
      const res = await fetch(
        `/api/cabinet/curator/lessons/${encodeURIComponent(lesson.sanityId)}/files`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field, index, published }),
        },
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось обновить файл');
      }
    }, published ? 'Файл опубликован' : 'Публикация снята');

  const canStart = lesson.sessionStatus !== 'live' && lesson.sessionStatus !== 'completed';
  const canEnd = lesson.sessionStatus === 'live';

  return (
    <div className="curator-panel curator-panel--wide">
      <button type="button" className="curator-link-btn curator-back-btn" onClick={onBack}>
        ← Все занятия
      </button>

      <header className="curator-lesson-head">
        <div>
          <p className="curator-kicker">{lesson.moduleTitle}</p>
          <h1 className="curator-title">Занятие №{lesson.lessonNumber}</h1>
          <p className="curator-lesson-name">{lesson.title}</p>
        </div>
        <span className={`curator-pill curator-pill--lg ${sessionPillClass(lesson.sessionStatus)}`}>
          {sessionLabel(lesson.sessionStatus)}
        </span>
      </header>

      <div className="curator-lesson-grid">
        <section className="curator-card">
          <h2>Расписание и ссылки</h2>
          <p className="curator-help">
            Дата отображается у учеников на карте курса. Эфир виден только после нажатия «Начать вебинар».
          </p>
          <label className="curator-field">
            <span>Дата и время эфира</span>
            <input
              type="datetime-local"
              value={scheduledAt}
              disabled={!writeEnabled || busy}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </label>
          <label className="curator-field">
            <span>Ссылка на YouTube-трансляцию</span>
            <input
              type="url"
              value={liveUrl}
              disabled={!writeEnabled || busy}
              onChange={(e) => setLiveUrl(e.target.value)}
              placeholder="https://youtube.com/live/..."
            />
          </label>
          <label className="curator-field">
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
            <button type="button" className="curator-btn" disabled={busy} onClick={() => void saveFields()}>
              Сохранить
            </button>
          ) : null}
        </section>

        <section className="curator-card curator-card--actions">
          <h2>Управление эфиром</h2>
          <div className="curator-session-actions">
            <button
              type="button"
              className="curator-btn curator-btn-accent"
              disabled={busy || !canStart || !writeEnabled}
              onClick={() => void sessionAction('start')}
            >
              ▶ Начать вебинар
            </button>
            <button
              type="button"
              className="curator-btn curator-btn-danger"
              disabled={busy || !canEnd}
              onClick={() => void sessionAction('end')}
            >
              ■ Закончить занятие
            </button>
          </div>
          {lesson.startedAt ? (
            <p className="curator-muted">Эфир начат: {formatDateTime(lesson.startedAt)}</p>
          ) : null}
          {lesson.endedAt ? (
            <p className="curator-muted">Завершено: {formatDateTime(lesson.endedAt)}</p>
          ) : null}

          <h3>Уведомления в Telegram</h3>
          <p className="curator-help">
            Отдельные рассылки ученикам с доступом к занятию. «Начать вебинар» уже отправляет уведомление об эфире.
          </p>
          <div className="curator-btn-row">
            <button
              type="button"
              className="curator-btn curator-btn-ghost"
              disabled={busy}
              onClick={() => void notify('materials')}
            >
              Материалы опубликованы
            </button>
            <button
              type="button"
              className="curator-btn curator-btn-ghost"
              disabled={busy}
              onClick={() => void notify('recording')}
            >
              Запись готова
            </button>
          </div>
        </section>
      </div>

      <div className="curator-lesson-files-grid">
        <FileBlock
          title="Материалы"
          files={lesson.materials}
          writeEnabled={writeEnabled}
          busy={busy}
          onUpload={(file) => void uploadFile('lessonMaterials', file)}
          onToggle={(index, published) => void togglePublished('lessonMaterials', index, published)}
        />
        <FileBlock
          title="Домашнее задание"
          files={lesson.homeworkFiles}
          writeEnabled={writeEnabled}
          busy={busy}
          onUpload={(file) => void uploadFile('lessonHomeworkFiles', file)}
          onToggle={(index, published) =>
            void togglePublished('lessonHomeworkFiles', index, published)
          }
        />
      </div>
    </div>
  );
}

export default function CuratorLessonsPanel({
  data,
  selectedLessonId,
  onSelectLesson,
  onBack,
  busy,
  runAction,
}: {
  data: CuratorCabinetData;
  selectedLessonId: string | null;
  onSelectLesson: (id: string | null) => void;
  onBack: () => void;
  busy: boolean;
  runAction: RunAction;
}) {
  const [moduleFilter, setModuleFilter] = useState<number | 'all'>('all');

  const selectedLesson = useMemo(
    () => data.lessons.find((l) => l.sanityId === selectedLessonId) ?? null,
    [data.lessons, selectedLessonId],
  );

  if (selectedLesson) {
    return (
      <LessonEditor
        lesson={selectedLesson}
        busy={busy}
        writeEnabled={data.sanityWriteEnabled}
        onBack={onBack}
        runAction={runAction}
      />
    );
  }

  const filteredModules =
    moduleFilter === 'all'
      ? data.modules
      : data.modules.filter((_, i) => i === moduleFilter);

  return (
    <div className="curator-panel curator-panel--wide">
      <header className="curator-page-head">
        <div>
          <h1 className="curator-title">Занятия курса</h1>
          <p className="curator-muted">{data.lessons.length} занятий · статус задаётся вручную</p>
        </div>
      </header>

      <div className="curator-filter-row">
        <button
          type="button"
          className={`curator-filter-chip${moduleFilter === 'all' ? ' is-active' : ''}`}
          onClick={() => setModuleFilter('all')}
        >
          Все модули
        </button>
        {data.modules.map((mod, index) => (
          <button
            key={mod.title}
            type="button"
            className={`curator-filter-chip${moduleFilter === index ? ' is-active' : ''}`}
            onClick={() => setModuleFilter(index)}
          >
            {mod.title}
          </button>
        ))}
      </div>

      {filteredModules.map((mod, modIndex) => {
        const modLessons = data.lessons.filter((l) => mod.lessonIds.includes(l.sanityId));
        if (modLessons.length === 0) return null;
        return (
          <section key={mod.title} className="curator-module-block">
            <header className="curator-module-head">
              <i style={{ background: mod.color }} aria-hidden="true" />
              <div>
                <h2>{mod.title}</h2>
                <p className="curator-muted">{modLessons.length} занятий</p>
              </div>
            </header>
            <ul className="curator-lesson-table">
              {modLessons.map((lesson) => (
                <li key={lesson.sanityId}>
                  <button
                    type="button"
                    className="curator-lesson-row"
                    onClick={() => onSelectLesson(lesson.sanityId)}
                  >
                    <span className="curator-lesson-num">{String(lesson.lessonNumber).padStart(2, '0')}</span>
                    <span className="curator-lesson-info">
                      <strong>{lesson.title}</strong>
                      <em>{formatDate(lesson.scheduledAt)}</em>
                    </span>
                    <span className={`curator-pill ${sessionPillClass(lesson.sessionStatus)}`}>
                      {sessionLabel(lesson.sessionStatus)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
