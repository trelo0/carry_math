'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { FormDoc, FormField, FormMember, SanityDocValues } from '@/lib/admin/sanity-form-types';
import type { SettingsDocRef } from '@/lib/admin/settings-sections';

export type Values = Record<string, unknown>;

export type EditorDoc = {
  ref: SettingsDocRef;
  form: FormDoc;
  docs: SanityDocValues[];
};

export type EditorBlock = {
  title: string;
  items: EditorDoc[];
};

type Props = {
  items: EditorDoc[];
  blocks?: EditorBlock[];
  writeEnabled: boolean;
};

const rnd = () => Math.random().toString(16).slice(2, 14);

export function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export function initialFor(fields: FormField[]): Values {
  const out: Values = {};
  for (const f of fields) {
    if (f.initialValue !== undefined) out[f.name] = clone(f.initialValue);
    else if (f.type === 'object' && f.fields) {
      const nested = initialFor(f.fields);
      if (Object.keys(nested).length) out[f.name] = nested;
    }
  }
  return out;
}

export function pickValues(fields: FormField[], doc: Values | null): Values {
  if (!doc) return initialFor(fields);
  const out: Values = {};
  for (const f of fields) if (doc[f.name] !== undefined) out[f.name] = clone(doc[f.name]);
  return out;
}

export function sameValues(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function imageSrc(ref: string): string {
  return `/api/admin/settings/image?ref=${encodeURIComponent(ref)}`;
}

// ---------------------------------------------------------------------------
// Поля
// ---------------------------------------------------------------------------

function FieldShell({
  field,
  children,
  inline,
}: {
  field: Pick<FormField, 'title' | 'description' | 'required'>;
  children: React.ReactNode;
  inline?: boolean;
}) {
  return (
    <div className={`admin-sf__field${inline ? ' admin-sf__field--inline' : ''}`}>
      <span className="admin-sf__label">
        {field.title}
        {field.required ? <em title="Обязательное поле"> *</em> : null}
      </span>
      {field.description ? <span className="admin-sf__desc">{field.description}</span> : null}
      {children}
    </div>
  );
}

export function ImageInput({
  value,
  onChange,
  disabled,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  const ref = (value as { asset?: { _ref?: string } } | undefined)?.asset?._ref;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
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

  return (
    <div className="admin-sf__image">
      {ref ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageSrc(ref)} alt="" className="admin-sf__image-preview" />
      ) : (
        <div className="admin-sf__image-empty">Нет изображения</div>
      )}
      <div className="admin-sf__image-actions">
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
        <button
          type="button"
          className="admin-sf__btn"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          {busy ? 'Загрузка…' : ref ? 'Заменить' : 'Загрузить'}
        </button>
        {ref ? (
          <button
            type="button"
            className="admin-sf__btn admin-sf__btn--danger"
            disabled={disabled || busy}
            onClick={() => onChange(undefined)}
          >
            Убрать
          </button>
        ) : null}
      </div>
      {error ? <span className="admin-sf__error">{error}</span> : null}
    </div>
  );
}

function ScalarInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: Pick<FormField, 'type' | 'rows' | 'list' | 'placeholder' | 'readOnly'>;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
}) {
  const off = disabled || Boolean(field.readOnly);
  const str = value === undefined || value === null ? '' : String(value);

  if (field.list) {
    return (
      <select
        className="admin-sf__input"
        value={str}
        disabled={off}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">—</option>
        {field.list.map((o) => (
          <option key={o.value} value={o.value}>
            {o.title}
          </option>
        ))}
      </select>
    );
  }

  switch (field.type) {
    case 'text':
      return (
        <textarea
          className="admin-sf__input admin-sf__textarea"
          rows={Math.max(field.rows ?? 3, 3)}
          value={str}
          disabled={off}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'boolean':
      return (
        <label className="admin-sf__switch">
          <input
            type="checkbox"
            checked={value === true}
            disabled={off}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{value === true ? 'Да' : 'Нет'}</span>
        </label>
      );
    case 'date':
      return (
        <input
          type="date"
          className="admin-sf__input admin-sf__input--short"
          value={str.slice(0, 10)}
          disabled={off}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    case 'datetime':
      return (
        <input
          type="datetime-local"
          className="admin-sf__input admin-sf__input--short"
          value={str ? new Date(str).toLocaleString('sv-SE').replace(' ', 'T').slice(0, 16) : ''}
          disabled={off}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : undefined)}
        />
      );
    case 'number':
      return (
        <input
          type="text"
          inputMode="decimal"
          className="admin-sf__input admin-sf__input--short"
          value={str}
          disabled={off}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <input
          type="text"
          className="admin-sf__input"
          value={str}
          disabled={off}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function memberTitle(member: FormMember, item: unknown, index: number): string {
  if (member.type !== 'object') return String(item || `Элемент ${index + 1}`);
  const v = member.previewField ? (item as Values)?.[member.previewField] : undefined;
  const text = typeof v === 'string' ? v.trim() : '';
  const base = text ? (text.length > 70 ? `${text.slice(0, 70)}…` : text) : `${member.title ?? 'Элемент'} ${index + 1}`;
  return base;
}

function ArrayInput({
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
  const items = Array.isArray(value) ? (value as unknown[]) : [];
  const member = field.of?.[0];
  if (!member) return <span className="admin-sf__desc">Тип списка не поддерживается</span>;
  const multi = (field.of?.length ?? 0) > 1;

  const set = (next: unknown[]) => onChange(next.length ? next : undefined);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  const add = () => {
    if (member.type === 'object') {
      set([
        ...items,
        {
          ...(member.typeName ? { _type: member.typeName } : {}),
          _key: rnd(),
          ...initialFor(member.fields ?? []),
        },
      ]);
    } else {
      set([...items, '']);
    }
  };

  return (
    <div className="admin-sf__array">
      {items.map((item, i) => {
        const key = member.type === 'object' ? String((item as Values)._key ?? i) : `${i}`;
        const controls = (
          <span className="admin-sf__item-tools">
            <button type="button" className="admin-sf__icon" disabled={disabled || i === 0} onClick={() => move(i, -1)} title="Выше">
              ↑
            </button>
            <button
              type="button"
              className="admin-sf__icon"
              disabled={disabled || i === items.length - 1}
              onClick={() => move(i, 1)}
              title="Ниже"
            >
              ↓
            </button>
            <button
              type="button"
              className="admin-sf__icon admin-sf__icon--danger"
              disabled={disabled}
              onClick={() => set(items.filter((_, j) => j !== i))}
              title="Удалить"
            >
              ✕
            </button>
          </span>
        );

        if (member.type === 'object') {
          return (
            <details key={key} className="admin-sf__item" open={items.length <= 3}>
              <summary>
                <span className="admin-sf__item-num">{i + 1}</span>
                <span className="admin-sf__item-title">{memberTitle(member, item, i)}</span>
                {controls}
              </summary>
              <div className="admin-sf__item-body">
                <FieldList
                  fields={member.fields ?? []}
                  values={(item as Values) ?? {}}
                  disabled={disabled}
                  onChange={(name, v) => {
                    const next = [...items];
                    const cur = { ...((item as Values) ?? {}) };
                    if (v === undefined) delete cur[name];
                    else cur[name] = v;
                    next[i] = cur;
                    set(next);
                  }}
                />
              </div>
            </details>
          );
        }

        return (
          <div key={key} className="admin-sf__item admin-sf__item--flat">
            <span className="admin-sf__item-num">{i + 1}</span>
            <ScalarInput
              field={{ type: member.type }}
              value={item}
              disabled={disabled}
              onChange={(v) => {
                const next = [...items];
                next[i] = v ?? '';
                onChange(next);
              }}
            />
            {controls}
          </div>
        );
      })}
      {multi ? <span className="admin-sf__desc">Поддерживается только первый тип элементов</span> : null}
      <button type="button" className="admin-sf__btn admin-sf__btn--add" disabled={disabled} onClick={add}>
        + Добавить
      </button>
    </div>
  );
}

export function FieldList({
  fields,
  values,
  onChange,
  disabled,
}: {
  fields: FormField[];
  values: Values;
  onChange: (name: string, v: unknown) => void;
  disabled: boolean;
}) {
  return (
    <>
      {fields.map((f) => (
        <FieldEditor key={f.name} field={f} value={values[f.name]} disabled={disabled} onChange={(v) => onChange(f.name, v)} />
      ))}
    </>
  );
}

export function FieldEditor({
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
  if (field.type === 'object') {
    const obj = (value as Values | undefined) ?? {};
    return (
      <fieldset className="admin-sf__group">
        <legend>{field.title}</legend>
        {field.description ? <span className="admin-sf__desc">{field.description}</span> : null}
        <FieldList
          fields={field.fields ?? []}
          values={obj}
          disabled={disabled}
          onChange={(name, v) => {
            const next = { ...obj };
            if (v === undefined) delete next[name];
            else next[name] = v;
            onChange(Object.keys(next).length ? next : undefined);
          }}
        />
      </fieldset>
    );
  }

  if (field.type === 'array') {
    return (
      <FieldShell field={field}>
        <ArrayInput field={field} value={value} disabled={disabled || Boolean(field.readOnly)} onChange={onChange} />
      </FieldShell>
    );
  }

  if (field.type === 'image') {
    return (
      <FieldShell field={field}>
        <ImageInput value={value} disabled={disabled || Boolean(field.readOnly)} onChange={onChange} />
      </FieldShell>
    );
  }

  if (field.type === 'reference') {
    const ref = (value as { _ref?: string } | undefined)?._ref;
    return (
      <FieldShell field={field}>
        <code className="admin-sf__ref">{ref ?? '—'}</code>
        <span className="admin-sf__desc">Ссылку на документ меняйте в Sanity Studio.</span>
      </FieldShell>
    );
  }

  return (
    <FieldShell field={field} inline={field.type === 'boolean'}>
      <ScalarInput field={field} value={value} disabled={disabled} onChange={onChange} />
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// Документ
// ---------------------------------------------------------------------------

type SaveState = { type: 'ok' | 'error'; text: string; details?: string[] } | null;

function DocForm({
  doc,
  refCfg,
  form,
  writeEnabled,
  isNew,
  defaultOpen,
  heading,
  onSaved,
  onDeleted,
}: {
  doc: SanityDocValues | null;
  refCfg: SettingsDocRef;
  form: FormDoc;
  writeEnabled: boolean;
  isNew: boolean;
  defaultOpen: boolean;
  heading: string;
  onSaved?: (doc: SanityDocValues) => void;
  onDeleted?: () => void;
}) {
  const fields = useMemo(
    () => (refCfg.onlyFields ? form.fields.filter((f) => refCfg.onlyFields!.includes(f.name)) : form.fields),
    [form.fields, refCfg.onlyFields],
  );
  const [saved, setSaved] = useState<Values>(() => pickValues(fields, doc));
  const [values, setValues] = useState<Values>(() => clone(saved));
  const [id, setId] = useState<string | null>(doc?._id ?? null);
  const [rev, setRev] = useState<string | null>(doc?._rev ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<SaveState>(null);

  const dirty = isNew && !id ? true : !sameValues(values, saved);

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
    setMsg(null);
    try {
      const res = await fetch('/api/admin/settings/doc', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: form.name, id, values, rev }),
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
      setMsg({ type: 'ok', text: 'Сохранено и опубликовано на сайте' });
      onSaved?.(body.doc);
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Ошибка сети' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id) {
      onDeleted?.();
      return;
    }
    if (!window.confirm('Удалить документ? Действие необратимо.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/settings/doc?type=${encodeURIComponent(form.name)}&id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Не удалось удалить');
      onDeleted?.();
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Ошибка' });
      setBusy(false);
    }
  }

  const disabled = !writeEnabled || busy;

  return (
    <details className="admin-sf__doc" open={defaultOpen || undefined}>
      <summary>
        <span className="admin-sf__doc-title">{heading}</span>
        {dirty ? <span className="admin-sf__dirty">не сохранено</span> : null}
      </summary>
      <div className="admin-sf__doc-body">
        {form.description ? <p className="admin-sf__desc">{form.description}</p> : null}
        <FieldList fields={fields} values={values} disabled={disabled} onChange={setField} />
        <div className="admin-sf__bar">
          <button type="button" className="admin-sf__btn admin-sf__btn--primary" disabled={disabled || !dirty} onClick={() => void save()}>
            {busy ? 'Сохранение…' : 'Сохранить и опубликовать'}
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
          {refCfg.kind === 'list' ? (
            <button type="button" className="admin-sf__btn admin-sf__btn--danger" disabled={disabled} onClick={() => void remove()}>
              Удалить
            </button>
          ) : null}
          {msg ? <span className={`admin-sf__msg admin-sf__msg--${msg.type}`}>{msg.text}</span> : null}
        </div>
        {msg?.details?.length ? (
          <ul className="admin-sf__errors">
            {msg.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

function listHeading(form: FormDoc, doc: SanityDocValues | null, index: number): string {
  const candidates = ['name', 'title', 'question', 'text', 'caption', 'label', 'author'];
  for (const c of candidates) {
    const v = doc?.[c];
    if (typeof v === 'string' && v.trim()) return v.trim().length > 80 ? `${v.trim().slice(0, 80)}…` : v.trim();
  }
  return `${form.title} ${index + 1}`;
}

function DocSection({ item, writeEnabled, first }: { item: EditorDoc; writeEnabled: boolean; first: boolean }) {
  const { ref, form } = item;

  if (ref.kind === 'single') {
    return (
      <section className="admin-sf__section">
        <DocForm
          doc={item.docs[0] ?? null}
          refCfg={ref}
          form={form}
          writeEnabled={writeEnabled}
          isNew={!item.docs[0]}
          defaultOpen={first}
          heading={form.title}
        />
      </section>
    );
  }
  return <ListSection item={item} writeEnabled={writeEnabled} />;
}

function ListSection({ item, writeEnabled }: { item: EditorDoc; writeEnabled: boolean }) {
  const { ref, form } = item;
  const [rows, setRows] = useState(() => item.docs.map((d) => ({ key: d._id ?? rnd(), doc: d as SanityDocValues | null })));

  return (
    <section className="admin-sf__section admin-sf__list">
      <div className="admin-sf__list-head">
        <h3>
          {form.title} <span>({rows.length})</span>
        </h3>
        <button
          type="button"
          className="admin-sf__btn admin-sf__btn--add"
          disabled={!writeEnabled}
          onClick={() => setRows((r) => [...r, { key: `new-${rnd()}`, doc: null }])}
        >
          + Добавить
        </button>
      </div>
      {rows.length === 0 ? <p className="admin-sf__desc">Документов пока нет.</p> : null}
      {rows.map((row, i) => (
        <DocForm
          key={row.key}
          doc={row.doc}
          refCfg={ref}
          form={form}
          writeEnabled={writeEnabled}
          isNew={!row.doc}
          defaultOpen={!row.doc}
          heading={listHeading(form, row.doc, i)}
          onSaved={(doc) =>
            setRows((r) => r.map((x) => (x.key === row.key ? { ...x, doc } : x)))
          }
          onDeleted={() => setRows((r) => r.filter((x) => x.key !== row.key))}
        />
      ))}
    </section>
  );
}

function EditorBody({ items, writeEnabled }: { items: EditorDoc[]; writeEnabled: boolean }) {
  return (
    <>
      {items.map((item, i) => (
        <DocSection key={`${item.ref.type}-${item.ref.kind}`} item={item} writeEnabled={writeEnabled} first={i === 0} />
      ))}
    </>
  );
}

export default function AdminSanityEditor({ items, blocks, writeEnabled }: Props) {
  if (blocks?.length) {
    return (
      <div className="admin-sf admin-sf--blocked">
        {blocks.map((block) => (
          <section key={block.title} className="admin-sf__block">
            <header className="admin-sf__block-head">
              <h2 className="admin-sf__block-title">{block.title}</h2>
            </header>
            <div className="admin-sf__block-body">
              <EditorBody items={block.items} writeEnabled={writeEnabled} />
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="admin-sf">
      <EditorBody items={items} writeEnabled={writeEnabled} />
    </div>
  );
}
