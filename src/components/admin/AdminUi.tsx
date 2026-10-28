'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

export type SelectOption = { value: string; label: string };

/** Кастомный выпадающий список (вместо нативного select). Список — fixed, не обрезается модалками. */
export function AdminSelect({
  value,
  options,
  onChange,
  label,
  className = '',
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number; max: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const r = root.current?.getBoundingClientRect();
    if (r) {
      const below = window.innerHeight - r.bottom - 16;
      const above = r.top - 16;
      const flip = below < 200 && above > below;
      const max = Math.max(160, Math.min(320, flip ? above : below));
      setPos({
        left: r.left,
        width: r.width,
        max,
        ...(flip ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onScroll = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <div className={`admin-select ${className}`} ref={root}>
      <button
        type="button"
        className={`admin-select__btn${open ? ' is-open' : ''}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="admin-select__text">{current?.label ?? '—'}</span>
        <svg className="admin-select__arrow" viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && pos ? (
        <ul
          ref={list}
          className="admin-select__list"
          role="listbox"
          aria-label={label}
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.max }}
        >
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                type="button"
                className={`admin-select__opt${o.value === value ? ' is-active' : ''}`}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** Переключатель (вместо чекбокса). */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`admin-switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="admin-switch__knob" />
    </button>
  );
}

/** Строка «название + пояснение + переключатель». */
export function SwitchRow({
  title,
  hint,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="admin-switchrow">
      <div className="admin-switchrow__text">
        <span className="admin-switchrow__title">{title}</span>
        {hint ? <span className="admin-switchrow__hint">{hint}</span> : null}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={title} />
    </div>
  );
}
const subscribe = () => () => undefined;

function usePortalTarget(): HTMLElement | null {
  return useSyncExternalStore(
    subscribe,
    () => document.querySelector<HTMLElement>('.admin-panel') ?? document.body,
    () => null,
  );
}

/** Модалка по центру или правая выезжающая панель. */
export function AdminDialog({
  open,
  onClose,
  title,
  children,
  footer,
  variant = 'modal',
  wide,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  variant?: 'modal' | 'drawer';
  wide?: boolean;
  busy?: boolean;
}) {
  const target = usePortalTarget();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, busy, onClose]);

  if (!open || !target) return null;

  return createPortal(
    <div
      className={`admin-dialog admin-dialog--${variant}`}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={`admin-dialog__panel${wide ? ' admin-dialog__panel--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="admin-dialog__head">
          <h3 className="admin-dialog__title">{title}</h3>
          <button type="button" className="admin-dialog__close" aria-label="Закрыть" disabled={busy} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="admin-dialog__body">{children}</div>
        {footer ? <footer className="admin-dialog__foot">{footer}</footer> : null}
      </div>
    </div>,
    target,
  );
}

export function slugify(input: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
    м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
    щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ў: 'u',
  };
  const out = input
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return out;
}

/** Подтверждение опасного действия (удаление). requireText — ввести для подтверждения. */
type ConfirmProps = {
  open: boolean;
  title: string;
  text: React.ReactNode;
  confirmLabel: string;
  requireText?: string;
  busy?: boolean;
  error?: string | null;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog(props: ConfirmProps) {
  return props.open ? <ConfirmInner {...props} /> : null;
}

function ConfirmInner({
  open,
  title,
  text,
  confirmLabel,
  requireText,
  busy,
  error,
  tone = 'danger',
  onConfirm,
  onClose,
}: ConfirmProps) {
  const [typed, setTyped] = useState('');
  const ok = !requireText || typed.trim().toLowerCase() === requireText.trim().toLowerCase();

  return (
    <AdminDialog
      open={open}
      onClose={onClose}
      title={title}
      busy={busy}
      footer={
        <>
          <span />
          <div className="admin-dialog__actions">
            <button type="button" className="admin-sf__btn" disabled={busy} onClick={onClose}>
              Отмена
            </button>
            <button type="button" className={`admin-sf__btn ${tone === 'danger' ? 'admin-sf__btn--danger-solid' : 'admin-sf__btn--primary'}`} disabled={busy || !ok} onClick={onConfirm}>
              {busy ? 'Подождите…' : confirmLabel}
            </button>
          </div>
        </>
      }
    >
      <div className="admin-confirm">
        <span className={`admin-confirm__icon${tone === 'primary' ? ' is-primary' : ''}`} aria-hidden>
          <svg viewBox="0 0 24 24" width="26" height="26">
            <path d="M12 3 2.5 20h19L12 3Zm0 6v5m0 3v.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="admin-confirm__text">{text}</div>
      </div>
      {requireText ? (
        <label className="admin-sf__field">
          <span className="admin-sf__label">
            Для подтверждения введите: <b>{requireText}</b>
          </span>
          <input className="admin-sf__input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </label>
      ) : null}
      {error ? <p className="admin-sf__msg admin-sf__msg--error">{error}</p> : null}
    </AdminDialog>
  );
}