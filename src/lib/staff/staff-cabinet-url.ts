import type { CabinetPreviewRole } from '@/lib/admin/settings-sections';
import type { StaffCourseAssignmentRole } from '@/lib/staff/course-assignment-ui';

export type StaffCabinetUrlParams = {
  section?: string;
  /** Вкладка экрана курса: overview | lessons | students. */
  tab?: string;
  lesson?: string;
  courseId?: number | null;
  courseRole?: StaffCourseAssignmentRole | null;
  cabinetPreview?: CabinetPreviewRole | null;
};

export function buildStaffCabinetPath(params: StaffCabinetUrlParams): string {
  const sp = new URLSearchParams();
  if (params.section) sp.set('section', params.section);
  if (params.tab) sp.set('tab', params.tab);
  if (params.lesson) sp.set('lesson', params.lesson);
  if (params.courseId != null && Number.isFinite(params.courseId)) {
    sp.set('courseId', String(params.courseId));
  }
  if (params.courseRole === 'curator' || params.courseRole === 'check') {
    sp.set('courseRole', params.courseRole);
  }
  if (params.cabinetPreview === 'curator' || params.cabinetPreview === 'teacher') {
    sp.set('cabinetPreview', params.cabinetPreview);
  }
  const qs = sp.toString();
  return qs ? `/cabinet/staff?${qs}` : '/cabinet/staff';
}

export function parseStaffCourseRole(value: string | undefined): StaffCourseAssignmentRole | null {
  return value === 'curator' || value === 'check' ? value : null;
}
