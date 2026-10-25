'use client';

import type { WeekStats } from '@/lib/teacher/schedule-reference-utils';
import { IconChartRef } from './ScheduleRefIcons';

const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

export default function ScheduleWeekStats({ stats }: { stats: WeekStats }) {
  const percent = stats.attendance;
  const dash = percent == null ? 0 : (percent / 100) * RING_C;

  return (
    <section className="sr-card sr-stats">
      <h2 className="sr-card-title">
        <IconChartRef size={16} />
        Статистика за неделю
      </h2>
      <ul className="sr-stats-list">
        <li className="sr-stat">
          <span>Проведено занятий</span>
          <strong className="sr-stat-num sr-stat-num--ok">{stats.completed}</strong>
        </li>
        <li className="sr-stat">
          <span>Запланировано</span>
          <strong className="sr-stat-num sr-stat-num--info">{stats.scheduled}</strong>
        </li>
        <li className="sr-stat">
          <span>Отменено</span>
          <strong className={`sr-stat-num${stats.cancelled > 0 ? ' sr-stat-num--bad' : ' sr-stat-num--muted'}`}>
            {stats.cancelled}
          </strong>
        </li>
        <li className="sr-stat sr-stat--ring">
          <div>
            <span>Посещаемость</span>
            <strong className="sr-stat-pct">{percent == null ? '—' : `${percent}%`}</strong>
          </div>
          <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
            <circle cx="32" cy="32" r={RING_R} className="sr-ring-bg" />
            <circle
              cx="32"
              cy="32"
              r={RING_R}
              className="sr-ring-fg"
              strokeDasharray={`${dash} ${RING_C}`}
              transform="rotate(-90 32 32)"
            />
          </svg>
        </li>
      </ul>
    </section>
  );
}
