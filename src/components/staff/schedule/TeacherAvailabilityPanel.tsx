'use client';

import ScheduleDayWorkHours from './ScheduleDayWorkHours';
import type { TeacherAvailabilitySlot } from '@/lib/teacher/schedule-types';

const WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

type Props = {
  availability: TeacherAvailabilitySlot[];
  busy: boolean;
  runAction: import('@/lib/staff/run-action').StaffRunAction;
};

function dateForDayIndex(dayIndex: number): Date {
  const now = new Date();
  const current = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const diff = dayIndex - current;
  const d = new Date(now);
  d.setDate(d.getDate() + diff);
  d.setHours(12, 0, 0, 0);
  return d;
}

/** Legacy full-week view; sidebar route removed — editing lives in Schedule day view. */
export default function TeacherAvailabilityPanel({ availability, busy, runAction }: Props) {
  return (
    <div className="curator-panel schedule-availability-page">
      <h1 className="curator-title">Моя доступность</h1>
      <p className="curator-muted">Настройка перенесена в «Расписание» → режим «День».</p>
      <div className="staff-availability-week">
        {WEEKDAYS.map((label, dayIndex) => (
          <section key={label} className="staff-availability-day">
            <ScheduleDayWorkHours
              day={dateForDayIndex(dayIndex)}
              availability={availability}
              busy={busy}
              runAction={runAction}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
