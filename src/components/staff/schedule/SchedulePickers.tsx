'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { TeacherRosterStudent } from '@/lib/teacher/cabinet-data';
import type { PickerOption } from '@/lib/teacher/schedule-picker-utils';
import {
  buildTimeOptions,
  formatTimeParts,
  parseManualTime,
  parseTimeParts,
} from '@/lib/teacher/schedule-picker-utils';
import {
  IconChevronDownRef,
  IconCalendarRef,
  IconChevronLeftRef,
  IconChevronRightRef,
} from './ScheduleRefIcons';
import {
  dateKey,
  formatMonthTitle,
  getMonthGridDays,
  isSameDay,
  startOfMonth,
} from '@/lib/teacher/schedule-utils';
import { WEEKDAYS_SHORT } from '@/lib/teacher/schedule-reference-utils';

type DropdownProps = {
  value: string;
  onChange: (value: string) => void;
  options: PickerOption[];
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  'aria-label'?: string;
};

export function ScheduleDropdown({
  value,
  onChange,
  options,
  placeholder = 'Выберите…',
  disabled,
  searchable,
  searchPlaceholder = 'Поиск…',
  emptyLabel = 'Нет вариантов',
  'aria-label': ariaLabel,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((item) => item.value === value);

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.sub?.toLowerCase().includes(q) ||
        item.value.toLowerCase().includes(q),
    );
  }, [options, query, searchable]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      // Закрытие списка сбрасывает поиск.
      setQuery('');
    };
  }, [open]);

  return (
    <div
      className={`sr-dd${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="sr-dd-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => !disabled && setOpen((prev) => !prev)}
      >
        <span className="sr-dd-trigger-text">
          {selected ? (
            <span className="sr-dd-value">{selected.label}</span>
          ) : (
            <span className="sr-dd-placeholder">{placeholder}</span>
          )}
        </span>
        <IconChevronDownRef size={14} />
      </button>
      {open ? (
        <div className="sr-dd-panel">
          {searchable ? (
            <input
              type="search"
              className="sr-dd-search"
              value={query}
              placeholder={searchPlaceholder}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          ) : null}
          <ul className="sr-dd-menu" role="listbox">
            {filtered.length === 0 ? (
              <li className="sr-dd-empty">{emptyLabel}</li>
            ) : (
              filtered.map((item) => (
                <li key={item.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={item.value === value}
                    disabled={item.disabled}
                    className={`sr-dd-item${item.value === value ? ' is-active' : ''}`}
                    onClick={() => {
                      if (item.disabled) return;
                      onChange(item.value);
                      setOpen(false);
                    }}
                  >
                    <span className="sr-dd-item-label">{item.label}</span>
                    {item.sub ? <span className="sr-dd-item-sub">{item.sub}</span> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatDateLabel(key: string): string {
  return parseDateKey(key).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function ScheduleDateSelect({
  value,
  onChange,
  minKey,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  minKey: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewMonth, setViewMonth] = useState(() => parseDateKey(value || minKey));
  const todayKey = useMemo(() => dateKey(new Date()), []);

  const monthStart = startOfMonth(viewMonth);
  const days = getMonthGridDays(viewMonth);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Синхронизация отображаемого месяца с выбранной датой (без эффекта).
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (value) setViewMonth(parseDateKey(value));
  }

  // На узких экранах календарь раскрывается в потоке — прокручиваем модалку к нему.
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector('.sr-date-cal-panel')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const shiftMonth = (delta: number) => {
    setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const pick = (day: Date) => {
    const key = dateKey(day);
    if (key < minKey) return;
    onChange(key);
    setOpen(false);
  };

  const label = value ? formatDateLabel(value) : 'Выберите дату';

  return (
    <div
      className={`sr-dd sr-date-cal${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="sr-dd-trigger"
        disabled={disabled}
        aria-label="Дата"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => !disabled && setOpen((prev) => !prev)}
      >
        <span className="sr-dd-trigger-text">
          <span className={value ? 'sr-dd-value' : 'sr-dd-placeholder'}>{label}</span>
        </span>
        <IconCalendarRef size={15} />
      </button>
      {open ? (
        <div className="sr-dd-panel sr-date-cal-panel" role="dialog" aria-label="Календарь">
          <div className="sr-date-cal-head">
            <button type="button" className="sr-date-cal-nav" aria-label="Предыдущий месяц" onClick={() => shiftMonth(-1)}>
              <IconChevronLeftRef size={16} />
            </button>
            <strong>{formatMonthTitle(viewMonth)}</strong>
            <button type="button" className="sr-date-cal-nav" aria-label="Следующий месяц" onClick={() => shiftMonth(1)}>
              <IconChevronRightRef size={16} />
            </button>
          </div>
          <div className="sr-date-cal-weekdays">
            {WEEKDAYS_SHORT.map((wd) => (
              <span key={wd}>{wd}</span>
            ))}
          </div>
          <div className="sr-date-cal-days">
            {days.map((day) => {
              const key = dateKey(day);
              const inMonth = day.getMonth() === monthStart.getMonth();
              const isPast = key < minKey;
              const isToday = key === todayKey;
              const isSelected = value ? isSameDay(day, parseDateKey(value)) : false;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={isPast}
                  className={`sr-date-cal-day${inMonth ? '' : ' is-outside'}${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}${isPast ? ' is-disabled' : ''}`}
                  onClick={() => pick(day)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Время: поле ввода ЧЧ:ММ + выпадающий список (как у ученика/даты). */
export function ScheduleTimeField({
  value,
  onChange,
  disabled,
  minuteStep = 1,
  onEditorActiveChange,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Шаг в списке (15 — рабочее время; для занятий список 15 мин, ввод — любая минута). */
  minuteStep?: number;
  /** Фокус или открыт список — для показа шкалы свободного времени рядом. */
  onEditorActiveChange?: (active: boolean) => void;
  'aria-label'?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const committed = formatTimeParts(parseTimeParts(value).hour, parseTimeParts(value).minute);
  const shown = draft ?? committed;
  const listStep = minuteStep > 1 ? minuteStep : 15;
  const options = useMemo(() => buildTimeOptions(listStep), [listStep]);

  useEffect(() => {
    setDraft(null);
  }, [committed]);

  const releaseEditor = () => {
    window.setTimeout(() => {
      if (!rootRef.current?.contains(document.activeElement)) {
        onEditorActiveChange?.(false);
      }
    }, 120);
  };

  useEffect(() => {
    if (open) onEditorActiveChange?.(true);
    else releaseEditor();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- releaseEditor stable enough
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const placePanel = () => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const maxMenu = Math.min(240, Math.max(120, spaceBelow));
      setPanelStyle({
        position: 'fixed',
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
        zIndex: 260,
        maxHeight: maxMenu + 8,
      });
    };
    placePanel();
    window.addEventListener('resize', placePanel);
    window.addEventListener('scroll', placePanel, true);
    return () => {
      window.removeEventListener('resize', placePanel);
      window.removeEventListener('scroll', placePanel, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const list = listRef.current;
      const active = list?.querySelector<HTMLElement>('.is-active');
      if (!list || !active) return;
      const top = active.offsetTop - list.clientHeight / 2 + active.offsetHeight / 2;
      list.scrollTop = Math.max(0, top);
    });
    return () => cancelAnimationFrame(id);
  }, [open, committed]);

  const commitDraft = () => {
    if (draft === null) return;
    const parsed = parseManualTime(draft, 1);
    if (parsed) onChange(parsed);
    setDraft(null);
  };

  const pickFromList = (next: string) => {
    onChange(next);
    setDraft(null);
    setOpen(false);
  };

  return (
    <div
      className={`sr-time-field-wrap sr-time-combo${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
      ref={rootRef}
    >
      <input
        type="text"
        className="sr-time-field sr-time-field--text"
        value={shown}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder="ЧЧ:ММ"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => onEditorActiveChange?.(true)}
        onBlur={() => {
          commitDraft();
          releaseEditor();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitDraft();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <button
        type="button"
        className={`sr-time-field-icon${open ? ' is-active' : ''}`}
        disabled={disabled}
        aria-label={`${ariaLabel ?? 'Время'}: список`}
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
      >
        <IconChevronDownRef size={14} />
      </button>
      {open ? (
        <div className="sr-dd-panel sr-time-combo-panel sr-time-combo-panel--fixed" style={panelStyle}>
          <ul
            className="sr-dd-menu"
            ref={listRef}
            role="listbox"
            style={{ maxHeight: typeof panelStyle.maxHeight === 'number' ? panelStyle.maxHeight - 8 : undefined }}
          >
            {options.map((item) => (
              <li key={item.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={item.value === committed}
                  className={`sr-dd-item${item.value === committed ? ' is-active' : ''}`}
                  onClick={() => pickFromList(item.value)}
                >
                  <span className="sr-dd-item-label">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ScheduleRosterSelect({
  value,
  onChange,
  roster,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  roster: TeacherRosterStudent[];
  disabled?: boolean;
}) {
  const options = useMemo(
    (): PickerOption[] => [
      { value: '', label: 'Без ученика', sub: 'Только название в карточке' },
      ...roster.map((student) => ({
        value: String(student.id),
        label: student.name,
        sub: [student.classLabel ? `${student.classLabel} кл.` : null, student.phone]
          .filter(Boolean)
          .join(' · ') || undefined,
      })),
    ],
    [roster],
  );

  return (
    <ScheduleDropdown
      value={value}
      onChange={onChange}
      options={options}
      placeholder="Выберите ученика"
      disabled={disabled}
      searchable={roster.length > 6}
      searchPlaceholder="Имя или класс…"
      emptyLabel="Ученики не найдены"
      aria-label="Ученик"
    />
  );
}
