'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { FieldEditor, clone, initialFor, pickValues, sameValues, type Values } from '@/components/admin/AdminSanityEditor';
import type { FormField, SanityDocValues } from '@/lib/admin/sanity-form-types';
import type { CourseScope } from '@/lib/admin/course-docs';

type SaveState = { type: 'ok' | 'error'; text: string; details?: string[] } | null;

export function ColorPicker({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  const current = typeof value === 'string' ? value : '';
  return (
    <div className="admin-sf__field">
      <span className="admin-sf__label">{field.title}</span>
      <div className="admin-colors" role="radiogroup" aria-label={field.title}>
        {(field.list ?? []).map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={current === o.value}
            title={o.title}
            disabled={disabled}
            className={`admin-colors__dot${current === o.value ? ' is-active' : ''}`}
            style={{ background: o.value }}
            onClick={() => onChange(o.value)}
          />
        ))}
      </div>
    </div>
  );
}

export type FieldRenderCtx = {
  values: Values;
  disabled: boolean;
  setField: (name: string, v: unknown) => void;
};

type Props = {
  scope: CourseScope;
  fields: FormField[];
  doc: SanityDocValues | null;
  /** Sanity _id существующего документа; нет — создаём новый. */
  id?: string | null;
  /** Курс (для нового модуля) или модуль (для нового занятия). */
  parentId?: string | null;
  writeEnabled: boolean;
  submitLabel?: string;
  /** Для создания кнопка активна сразу. */
  isNew?: boolean;
  onSaved?: (doc: SanityDocValues) => void;
  onBusy?: (busy: boolean) => void;
  /** Обновить серверные данные страницы (шапка курса и т.п.) после сохранения. */
  refreshOnSave?: boolean;
  children?: React.ReactNode;
  /** Вставка до полей формы (например, поле slug read-only). */
  top?: React.ReactNode;
  className?: string;
  /** Свой рендер отдельных полей; null — стандартный. */
  renderField?: (field: FormField, ctx: FieldRenderCtx) => React.ReactNode | null;
  /** Полная раскладка: nodes — готовые поля по имени, bar — панель сохранения. */
  layout?: (slots: LayoutSlots) => React.ReactNode;
  /** Доп. элементы справа в панели сохранения (например, «Удалить»). */
  barExtra?: React.ReactNode;
};

export type LayoutSlots = {
  nodes: Record<string, React.ReactNode>;
  top: React.ReactNode;
  bar: React.ReactNode;
  ctx: FieldRenderCtx;
};

export default function AdminCourseDocForm({
  scope,
  fields,
  doc,
  id: idProp,
  parentId,
  writeEnabled,
  submitLabel = 'Сохранить и опубликовать',
  isNew,
  onSaved,
  onBusy,
  refreshOnSave,
  children,
  top,
  className,
  renderField,
  layout,
  barExtra,
}: Props) {
  const router = useRouter();
  const [saved, setSaved] = useState<Values>(() => pickValues(fields, doc));
  const [values, setValues] = useState<Values>(() => clone(saved));
  const [id, setId] = useState<string | null>(idProp ?? doc?._id ?? null);
  const [rev, setRev] = useState<string | null>(doc?._rev ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<SaveState>(null);

  const dirty = useMemo(() => (isNew && !id ? true : !sameValues(values, saved)), [isNew, id, values, saved]);

  const setField = useCallback((name: string, v: unknown) => {
    setValues((prev) => {
      const next = { ...prev };
      if (v === undefined) delete next[name];
      else next[name] = v;
      return next;
    });
    setMsg(null);
  }, []);

  async function save() {
    setBusy(true);
    onBusy?.(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/courses/doc', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, id, parentId, values, rev }),
      });
      const body = (await res.json()) as { error?: string; details?: string[]; doc?: SanityDocValues };
      if (!res.ok || !body.doc) {
        setMsg({ type: 'error', text: body.error ?? 'Не удалось сохранить', details: body.details });
        return;
      }
      const next = pickValues(fields, body.doc);
      setSaved(next);
      setValues(clone(next));
      setId(body.doc._id ?? id);
      setRev(body.doc._rev ?? null);
      setMsg({ type: 'ok', text: 'Сохранено и опубликовано' });
      onSaved?.(body.doc);
      if (refreshOnSave) router.refresh();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Ошибка сети' });
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }

  const disabled = !writeEnabled || busy;
  const ctx: FieldRenderCtx = { values, disabled, setField };

  const nodes: Record<string, React.ReactNode> = {};
  for (const f of fields) {
    const custom = renderField?.(f, ctx);
    nodes[f.name] = custom ? (
      custom
    ) : f.name === 'color' && f.list ? (
      <ColorPicker field={f} value={values[f.name]} disabled={disabled} onChange={(v) => setField(f.name, v)} />
    ) : (
      <FieldEditor field={f} value={values[f.name]} disabled={disabled} onChange={(v) => setField(f.name, v)} />
    );
  }

  const bar = (
    <>
      {!writeEnabled ? (
        <p className="admin-sf__msg admin-sf__msg--error">Запись в Sanity отключена: не задан SANITY_API_WRITE_TOKEN.</p>
      ) : null}
      {msg?.details?.length ? (
        <ul className="admin-sf__errors">
          {msg.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
      <div className="admin-cform__bar">
        <div className="admin-cform__bar-main">
          <button
            type="button"
            className="admin-sf__btn admin-sf__btn--primary"
            disabled={disabled || !dirty}
            onClick={() => void save()}
          >
            {busy ? 'Сохранение…' : submitLabel}
          </button>
          {dirty && !isNew ? (
            <button
              type="button"
              className="admin-sf__btn"
              disabled={busy}
              onClick={() => {
                setValues(clone(saved));
                setMsg(null);
              }}
            >
              Сбросить
            </button>
          ) : null}
          {msg ? <span className={`admin-sf__msg admin-sf__msg--${msg.type}`}>{msg.text}</span> : null}
        </div>
        {barExtra}
      </div>
    </>
  );

  return (
    <div className={`admin-cform ${className ?? ''}`}>
      {layout ? (
        layout({ nodes, top, bar, ctx })
      ) : (
        <>
          {top != null ? <Fragment key="admin-cform-top">{top}</Fragment> : null}
          {fields.map((f) => (
            <Fragment key={f.name}>{nodes[f.name]}</Fragment>
          ))}
          {children}
          {bar}
        </>
      )}
    </div>
  );
}
export { initialFor };
