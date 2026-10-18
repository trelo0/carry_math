import type { StaffCourseAssignmentOption } from '@/lib/curator/course-context';

export type StaffCourseAssignmentRole = 'curator' | 'check';

export type StaffCourseAssignmentRow = {
  courseId: number;
  title: string;
  role: StaffCourseAssignmentRole;
};

export const STAFF_COURSE_LIST_TITLE = '🎓 Курс';

export const STAFF_COURSE_LIST_INTRO =
  'Курсы, где вы назначены куратором или проверяющим ДЗ:';

export type StaffCourseListFilter = 'all' | 'curator-tools' | 'homework';

export function courseRoleBadge(role: StaffCourseAssignmentRole): string {
  return role === 'curator' ? 'куратор' : 'проверка ДЗ';
}

export function courseRoleBadgeShort(role: StaffCourseAssignmentRole): string {
  return role === 'curator' ? 'Куратор' : 'Проверка ДЗ';
}

export function filterStaffCourseRows(
  rows: StaffCourseAssignmentRow[],
  filter: StaffCourseListFilter,
): StaffCourseAssignmentRow[] {
  if (filter === 'all') return rows;
  if (filter === 'homework') return rows;
  return rows.filter((r) => r.role === 'curator');
}

export function staffCoursePickerLabel(row: StaffCourseAssignmentRow, maxLen = 60): string {
  return `${row.title} · ${courseRoleBadge(row.role)}`.slice(0, maxLen);
}

export function staffCoursePickerCallback(row: StaffCourseAssignmentRow): string {
  return `c:mc:${row.courseId}:${row.role}`;
}

export function staffCourseRowsFromOptions(
  options: StaffCourseAssignmentOption[],
): StaffCourseAssignmentRow[] {
  return options.map((o) => ({
    courseId: o.courseId,
    title: o.title,
    role: o.role,
  }));
}

export type StaffWebCourseSection =
  | 'course-overview'
  | 'course-students'
  | 'course-lessons'
  | 'course-history'
  | 'course-homework';

export function webNavSectionsForCourseRole(
  role: StaffCourseAssignmentRole | null,
  options?: { fullPreview?: boolean },
): StaffWebCourseSection[] {
  if (options?.fullPreview) {
    return [
      'course-overview',
      'course-students',
      'course-lessons',
      'course-history',
      'course-homework',
    ];
  }
  if (role === 'curator') {
    return [
      'course-overview',
      'course-students',
      'course-lessons',
      'course-history',
      'course-homework',
    ];
  }
  if (role === 'check') {
    return ['course-homework'];
  }
  return [];
}

/** Первая секция кабинета после выбора курса. */
export function defaultWebSectionForCourseRole(
  role: StaffCourseAssignmentRole | null,
  options?: { fullPreview?: boolean },
): StaffWebCourseSection | 'course-list' {
  const sections = webNavSectionsForCourseRole(role, options);
  return sections[0] ?? 'course-list';
}

export function webSectionNavLabel(section: StaffWebCourseSection, role: StaffCourseAssignmentRole | null): string {
  if (section === 'course-homework' && role === 'curator') return 'Прогресс ДЗ';
  if (section === 'course-homework') return 'Домашние задания';
  const labels: Record<Exclude<StaffWebCourseSection, 'course-homework'>, string> = {
    'course-overview': 'Обзор',
    'course-students': 'Ученики',
    'course-lessons': 'Модули и уроки',
    'course-history': 'История',
  };
  return labels[section as Exclude<StaffWebCourseSection, 'course-homework'>] ?? section;
}

export function canReviewHomeworkOnCourse(
  role: StaffCourseAssignmentRole | null,
  fullPreview: boolean,
): boolean {
  return fullPreview || role === 'check';
}

export function canViewHomeworkProgressOnCourse(
  role: StaffCourseAssignmentRole | null,
  fullPreview: boolean,
): boolean {
  return fullPreview || role === 'curator' || role === 'check';
}
