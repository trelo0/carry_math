export type AdminCourseAccessTone = 'open' | 'hidden' | 'closed';

export type CourseAccess = { label: 'Открытый' | 'Закрытый' | 'Архив'; hint: string; tone: AdminCourseAccessTone };

/**
 * Открытый — виден и принимает новых; Закрытый — для новых закрыт (showInCatalog=false);
 * Архив — закрыт полностью (courseClosed=true или publicationStatus=archived).
 */
export function courseAccess(input: {
  courseClosed?: boolean;
  showInCatalog?: boolean;
  publicationStatus?: string | null;
}): CourseAccess {
  if (input.courseClosed || input.publicationStatus === 'archived') {
    return { label: 'Архив', hint: 'Курс полностью закрыт', tone: 'closed' };
  }
  if (input.showInCatalog === false) {
    return { label: 'Закрытый', hint: 'Для новых учеников закрыт', tone: 'hidden' };
  }
  return { label: 'Открытый', hint: 'Принимает новых учеников', tone: 'open' };
}
