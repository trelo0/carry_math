'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AdminDialog, slugify } from '@/components/admin/AdminUi';
import { CoverUpload } from '@/components/admin/AdminFileInputs';

type Props = {
  open: boolean;
  onClose: () => void;
  writeEnabled: boolean;
};

export default function AdminCourseCreateModal({ open, onClose, writeEnabled }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [eyebrow, setEyebrow] = useState('');
  const [description, setDescription] = useState('');
  const [cover, setCover] = useState<unknown>(undefined);
  const [format, setFormat] = useState('Онлайн');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coverRef = (cover as { asset?: { _ref?: string } } | undefined)?.asset?._ref ?? null;
  const canSave = writeEnabled && !busy && title.trim().length > 0 && slug.length > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          cabinetEyebrow: eyebrow,
          description,
          coverImageRef: coverRef,
          deliveryFormat: format,
          slug,
        }),
      });
      const body = (await res.json()) as { error?: string; courseId?: number };
      if (!res.ok || !body.courseId) {
        setError(body.error ?? 'Не удалось создать курс');
        setBusy(false);
        return;
      }
      router.push(`/cabinet/admin/courses/${body.courseId}/overview`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети');
      setBusy(false);
    }
  }

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      title="Создать курс"
      wide
      busy={busy}
      footer={
        <>
          {error ? <span className="admin-sf__msg admin-sf__msg--error">{error}</span> : <span />}
          <div className="admin-dialog__actions">
            <button type="button" className="admin-sf__btn" disabled={busy} onClick={onClose}>
              Отмена
            </button>
            <button
              type="button"
              className="admin-sf__btn admin-sf__btn--primary"
              disabled={!canSave}
              onClick={() => void submit()}
            >
              {busy ? 'Создание…' : 'Создать курс'}
            </button>
          </div>
        </>
      }
    >
      <div className="admin-dialog__lead admin-dialog__lead--warn">
        <span className="admin-dialog__lead-num" aria-hidden>
          i
        </span>
        <span>
          Курс сразу публикуется в Sanity, но создаётся <b>закрытым</b> — его никто не увидит, пока вы не откроете доступ в настройках курса.
        </span>
      </div>

      <div className="admin-create">
        <div className="admin-create__cover">
          <CoverUpload value={cover} disabled={busy} onChange={setCover} hint="16:9, от 1280 px" />
        </div>
        <div className="admin-create__main">
          <label className="admin-sf__field">
            <span className="admin-sf__label">
              Название курса<em> *</em>
            </span>
            <input
              className="admin-sf__input"
              value={title}
              maxLength={120}
              autoFocus
              placeholder="Например, Математика ЦТ 2026"
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
            />
          </label>
          <label className="admin-sf__field">
            <span className="admin-sf__label">Заголовок над названием</span>
            <input
              className="admin-sf__input"
              value={eyebrow}
              maxLength={80}
              placeholder="Короткая строка в кабинете"
              onChange={(e) => setEyebrow(e.target.value)}
            />
          </label>
          <label className="admin-sf__field">
            <span className="admin-sf__label">Формат обучения</span>
            <input className="admin-sf__input" value={format} maxLength={60} onChange={(e) => setFormat(e.target.value)} />
          </label>
        </div>
      </div>

      <label className="admin-sf__field">
        <span className="admin-sf__label">Описание курса</span>
        <textarea
          className="admin-sf__input admin-sf__textarea"
          rows={3}
          value={description}
          placeholder="Коротко о курсе: для кого и что получит ученик"
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <label className="admin-sf__field">
        <span className="admin-sf__label">
          Код курса (slug)<em> *</em>
        </span>
        <span className="admin-sf__desc">Латиница и дефис. Используется в ссылках и оплате, потом не меняется.</span>
        <div className="admin-dialog__inline">
          <input
            className="admin-sf__input"
            value={slug}
            maxLength={96}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
            }}
          />
          <button
            type="button"
            className="admin-sf__btn"
            disabled={busy || !title.trim()}
            title="Сгенерировать из названия"
            onClick={() => {
              setSlugTouched(false);
              setSlug(slugify(title) || `course-${Date.now().toString(36)}`);
            }}
          >
            Сгенерировать
          </button>
        </div>
      </label>
    </AdminDialog>
  );
}
