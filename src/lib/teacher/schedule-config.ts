import type { ScheduleFilter } from '@/lib/teacher/schedule-types';

export type StaffScheduleMode = 'teacher' | 'curator' | 'combined';

export function resolveStaffScheduleMode(
  hasTeacher: boolean,
  hasCurator: boolean,
): StaffScheduleMode {
  if (hasTeacher && hasCurator) return 'combined';
  if (hasCurator) return 'curator';
  return 'teacher';
}

/** Курсовые вебинары в календаре не показываются — только индивидуальные и групповые занятия. */
export function getScheduleFilters(): { id: ScheduleFilter; label: string }[] {
  return [
    { id: 'all', label: 'Все' },
    { id: 'individual', label: 'Индивидуальные' },
    { id: 'group', label: 'Групповые' },
  ];
}

export function isScheduleFilterValid(filter: ScheduleFilter): boolean {
  return getScheduleFilters().some((item) => item.id === filter);
}


