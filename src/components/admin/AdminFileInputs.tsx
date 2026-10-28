'use client';

import { useRef, useState } from 'react';
import { Switch } from '@/components/admin/AdminUi';

type Values = Record<string, unknown>;

const imageSrc = (ref: string) => `/api/admin/settings/image?ref=${encodeURIComponent(ref)}`;
const newKey = () => Math.random().toString(36).slice(2, 12);

// ---------------------------------------------------------------------------
// Обложка
// ---------------------------------------------------------------------------

export function CoverUpload({
  value,
  onChange,
  disabled,
  title = 'Обложка курса',
  hint = 'Рекомендуем 16:9, от 1280 px по ширине',
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
  title?: string;
  hint?: string;
}) {
  const ref = (value as { asset?: { _ref?: string } } | undefined)?.asset?._ref;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Нужно изображение (JPG, PNG, WebP)');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/settings/image', { method: 'POST', body: fd });
      const body = (await res.json()) as { error?: string; ref?: string };
      if (!res.ok || !body.ref) throw new Error(body.error ?? 'Не удалось загрузить');
      const prev = (value ?? {}) as Values;
      onChange({ ...prev, _type: 'image', asset: { _type: 'reference', _ref: body.ref } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const off = disabled || busy;

  return (
    <div className="admin-cover">
      <div className="admin-cover__head">
        <span className="admin-sf__label">{title}</span>
        <span className="admin-sf__desc">{hint}</span>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <div
        className={`admin-cover__frame${ref ? ' has-image' : ''}${drag ? ' is-drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!off) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !off) void upload(f);
        }}
      >
        {ref ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageSrc(ref)} alt="" className="admin-cover__img" />
            <div className="admin-cover__overlay">
              <button type="button" className="admin-cover__btn" disabled={off} onClick={() => input.current?.click()}>
                {busy ? 'Загрузка…' : 'Заменить'}
              </button>
              <button type="button" className="admin-cover__btn admin-cover__btn--danger" disabled={off} onClick={() => onChange(undefined)}>
                Убрать
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="admin-cover__empty" disabled={off} onClick={() => input.current?.click()}>
            <svg viewBox="0 0 24 24" width="38" height="38" aria-hidden>
              <path
                d="M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5M12 15V4m0 0L8 8m4-4 4 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <strong>{busy ? 'Загрузка…' : 'Загрузить обложку'}</strong>
            <span>Нажмите или перетащите изображение сюда</span>
          </button>
        )}
      </div>
      {error ? <p className="admin-sf__msg admin-sf__msg--error">{error}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Чипы
// ---------------------------------------------------------------------------

const CHIP_SUGGESTIONS = ['Теория', 'Разбор задач', 'Практика', 'Домашнее задание'];

export function ChipsEditor({
  value,
  onChange,
  disabled,
  max = 4,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
  max?: number;
}) {
  const chips = Array.isArray(value) ? (value as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const [draft, setDraft] = useState('');
  const full = chips.length >= max;

  function add(text: string) {
    const t = text.trim();
    if (!t || full || chips.some((c) => c.toLowerCase() === t.toLowerCase())) return;
    onChange([...chips, t]);
    setDraft('');
  }

  return (
    <div className="admin-chips">
      <div className="admin-chips__list">
        {chips.map((c, i) => (
          <span key={`${c}-${i}`} className="admin-chips__chip">
            {c}
            <button
              type="button"
              aria-label={`Убрать «${c}»`}
              disabled={disabled}
              onClick={() => {
                const next = chips.filter((_, j) => j !== i);
                onChange(next.length ? next : undefined);
              }}
            >
              ×
            </button>
          </span>
        ))}
        {chips.length === 0 ? <span className="admin-chips__none">Чипов нет</span> : null}
      </div>
      <div className="admin-dialog__inline">
        <input
          className="admin-sf__input"
          value={draft}
          disabled={disabled || full}
          placeholder={full ? `Максимум ${max}` : 'Новый чип и Enter'}
          maxLength={30}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            }
          }}
        />
        <button type="button" className="admin-sf__btn" disabled={disabled || full || !draft.trim()} onClick={() => add(draft)}>
          Добавить
        </button>
      </div>
      {!full ? (
        <div className="admin-chips__sugg">
          {CHIP_SUGGESTIONS.filter((s) => !chips.includes(s)).map((s) => (
            <button key={s} type="button" disabled={disabled} onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Файлы занятия (lessonFile: file + published)
// ---------------------------------------------------------------------------

export type FileMeta = Record<string, { name: string; size: number | null }>;

type FileItem = {
  _key?: string;
  _type?: string;
  published?: boolean;
  file?: { _type?: string; asset?: { _type?: string; _ref?: string } };
};

function fmtSize(n: number | null | undefined): string {
  if (!n) return '';
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

export function LessonFilesEditor({
  value,
  onChange,
  disabled,
  meta,
  emptyText,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
  meta: FileMeta;
  emptyText: string;
}) {
  const items = (Array.isArray(value) ? (value as FileItem[]) : []).filter((i) => i?.file?.asset?._ref);
  const [names, setNames] = useState<FileMeta>(meta);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(files: File[]) {
    setBusy(true);
    setError(null);
    const added: FileItem[] = [];
    const nextNames: FileMeta = {};
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/admin/courses/file', { method: 'POST', body: fd });
        const body = (await res.json()) as { error?: string; ref?: string; name?: string; size?: number };
        if (!res.ok || !body.ref) throw new Error(body.error ?? `Не удалось загрузить «${file.name}»`);
        nextNames[body.ref] = { name: body.name ?? file.name, size: body.size ?? file.size };
        added.push({
          _key: newKey(),
          _type: 'lessonFile',
          published: false,
          file: { _type: 'file', asset: { _type: 'reference', _ref: body.ref } },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
      if (added.length) {
        setNames((p) => ({ ...p, ...nextNames }));
        onChange([...items, ...added]);
      }
    }
  }

  function patch(index: number, next: Partial<FileItem> | null) {
    const list = items.map((it, i) => (i === index ? { ...it, ...next } : it));
    const out = next === null ? items.filter((_, i) => i !== index) : list;
    onChange(out.length ? out : undefined);
  }

  const off = disabled || busy;

  return (
    <div className="admin-files">
      {items.length === 0 ? <p className="admin-files__empty">{emptyText}</p> : null}
      {items.map((it, i) => {
        const ref = it.file!.asset!._ref!;
        const m = names[ref];
        return (
          <div key={it._key ?? ref} className="admin-files__row">
            <span className="admin-files__icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path
                  d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="admin-files__name">
              <strong title={m?.name}>{m?.name ?? 'Файл'}</strong>
              <small>{fmtSize(m?.size)}</small>
            </span>
            <span className="admin-files__vis">
              <span>{it.published ? 'Виден ученикам' : 'Скрыт'}</span>
              <Switch checked={it.published === true} disabled={off} label="Виден ученикам" onChange={(v) => patch(i, { published: v })} />
            </span>
            <button type="button" className="admin-files__remove" aria-label="Убрать файл" disabled={off} onClick={() => patch(i, null)}>
              ×
            </button>
          </div>
        );
      })}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          if (list.length) void upload(list);
        }}
      />
      <button type="button" className="admin-files__add" disabled={off} onClick={() => input.current?.click()}>
        {busy ? 'Загрузка…' : '+ Добавить файл'}
      </button>
      {error ? <p className="admin-sf__msg admin-sf__msg--error">{error}</p> : null}
    </div>
  );
}
