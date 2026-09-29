const STARTED_LESSONS_KEY = 'teacher-started-lessons';

export function readStartedLessonIds(): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = sessionStorage.getItem(STARTED_LESSONS_KEY);
    if (!raw) return new Set();
    const ids = JSON.parse(raw) as number[];
    return new Set(ids.filter((id) => Number.isFinite(id)));
  } catch {
    return new Set();
  }
}

export function writeStartedLessonIds(ids: ReadonlySet<number>): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(STARTED_LESSONS_KEY, JSON.stringify([...ids]));
}
