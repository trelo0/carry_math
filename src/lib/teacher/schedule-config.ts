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

export function getScheduleFilters(mode: StaffScheduleMode): { id: ScheduleFilter; label: string }[] {
  if (mode === 'combined') {
    return [
      { id: 'all', label: 'Все' },
      { id: 'individual', label: 'Индивидуальные' },
      { id: 'group', label: 'Групповые' },
      { id: 'course', label: 'Курс' },
    ];
  }
  if (mode === 'curator') {
    return [
      { id: 'all', label: 'Все' },
      { id: 'course', label: 'Курс' },
    ];
  }
  return [
    { id: 'all', label: 'Все' },
    { id: 'individual', label: 'Индивидуальные' },
    { id: 'group', label: 'Групповые' },
  ];
}

export function isScheduleFilterValid(mode: StaffScheduleMode, filter: ScheduleFilter): boolean {
  return getScheduleFilters(mode).some((item) => item.id === filter);
}
