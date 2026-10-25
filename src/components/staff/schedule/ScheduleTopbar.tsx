'use client';

import type { ScheduleViewMode } from '@/lib/teacher/schedule-types';
import { formatClock } from '@/lib/teacher/schedule-reference-utils';
import {
  IconCalendarRef,
  IconChevronLeftRef,
  IconChevronRightRef,
  IconPanelRef,
} from './ScheduleRefIcons';

type Props = {
  viewMode: ScheduleViewMode;
  isMobile: boolean;
  periodLabel: string;
  showToday: boolean;
  nowMs: number;
  panelOpen: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onChangeView: (mode: ScheduleViewMode) => void;
  onTogglePanel: () => void;
};

const VIEW_TABS: { id: ScheduleViewMode; label: string }[] = [
  { id: 'week', label: 'Неделя' },
  { id: 'day', label: 'День' },
  { id: 'month', label: 'Месяц' },
];

export default function ScheduleTopbar({
  viewMode,
  isMobile,
  periodLabel,
  showToday,
  nowMs,
  panelOpen,
  onPrev,
  onNext,
  onToday,
  onChangeView,
  onTogglePanel,
}: Props) {
  const clock = formatClock(nowMs);
  const tabs = isMobile ? VIEW_TABS.filter((tab) => tab.id !== 'week') : VIEW_TABS;

  return (
    <header className="sr-topbar">
      <div className="sr-topbar-left">
        <div className="sr-title-block">
          <h1 className="sr-title">Расписание</h1>
          <p className="sr-subtitle">Ваши занятия и доступное время</p>
        </div>

        <div className="sr-period">
          <button type="button" className="sr-period-arrow" onClick={onPrev} aria-label="Предыдущий период">
            <IconChevronLeftRef size={14} />
          </button>
          <div className="sr-period-pill">
            <IconCalendarRef size={14} />
            <span>{periodLabel}</span>
            <IconCalendarRef size={14} />
          </div>
          <button
            type="button"
            className="sr-period-arrow sr-period-arrow--boxed"
            onClick={onNext}
            aria-label="Следующий период"
          >
            <IconChevronRightRef size={14} />
          </button>
          {showToday ? (
            <button type="button" className="sr-today-btn" onClick={onToday}>
              Сегодня
            </button>
          ) : null}
        </div>

        <div className="sr-view-tabs" role="tablist" aria-label="Режим календаря">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={viewMode === tab.id}
              className={`sr-view-tab${viewMode === tab.id ? ' is-active' : ''}`}
              onClick={() => onChangeView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sr-topbar-right">
        <button
          type="button"
          className={`sr-panel-toggle${panelOpen ? ' is-active' : ''}`}
          onClick={onTogglePanel}
          aria-pressed={panelOpen}
          aria-label="Панель дня"
          title="Панель дня"
        >
          <IconPanelRef size={18} />
        </button>
        <div className="sr-clock" aria-live="off">
          <strong>{clock.time}</strong>
          <span>{clock.date}</span>
        </div>
      </div>
    </header>
  );
}
