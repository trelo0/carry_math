import type { StaffCourseAssignmentRole } from '@/lib/staff/course-assignment-ui';

export type StaffCabinetUrlParams = {
  section?: string;
  lesson?: string;
  courseId?: number | null;
  courseRole?: StaffCourseAssignmentRole | null;
};

export function buildStaffCabinetPath(params: StaffCabinetUrlParams): string {
  const sp = new URLSearchParams();
  if (params.section) sp.set('section', params.section);
  if (params.lesson) sp.set('lesson', params.lesson);
  if (params.courseId != null && Number.isFinite(params.courseId)) {
    sp.set('courseId', String(params.courseId));
  }
  if (params.courseRole === 'curator' || params.courseRole === 'check') {
    sp.set('courseRole', params.courseRole);
  }
  const qs = sp.toString();
  return qs ? `/cabinet/staff?${qs}` : '/cabinet/staff';
}

export function parseStaffCourseRole(value: string | undefined): StaffCourseAssignmentRole | null {
  return value === 'curator' || value === 'check' ? value : null;
}
