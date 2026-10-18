import type { CabinetCourseViewSlice } from '@/lib/cabinet';

const KEY_PREFIX = 'cabinet:course-slice:';
const STALE_PREFIX = 'cabinet:map-stale:';
/** Не refetch карты при возврате с урока, если кеш свежее. */
export const CABINET_COURSE_SLICE_TTL_MS = 30 * 60_000;

type Cached = { at: number; slice: CabinetCourseViewSlice };

export function readCourseSliceCache(slug: string): Cached | null {
  if (typeof window === 'undefined' || !slug) return null;
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + slug);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (!parsed?.slice?.slug || parsed.slice.slug !== slug) return null;
    if (Date.now() - parsed.at > CABINET_COURSE_SLICE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearCourseSliceCache(slug?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (slug) {
      sessionStorage.removeItem(KEY_PREFIX + slug);
      return;
    }
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function writeCourseSliceCache(slug: string, slice: CabinetCourseViewSlice): void {
  if (typeof window === 'undefined' || !slug) return;
  try {
    const payload: Cached = { at: Date.now(), slice };
    sessionStorage.setItem(KEY_PREFIX + slug, JSON.stringify(payload));
  } catch {
    // quota / private mode
  }
}

export function isCourseSliceCacheFresh(cached: Cached): boolean {
  return Date.now() - cached.at < CABINET_COURSE_SLICE_TTL_MS;
}

export function markCourseMapStale(slug: string): void {
  if (typeof window === 'undefined' || !slug) return;
  try {
    sessionStorage.setItem(STALE_PREFIX + slug, '1');
  } catch {
    // ignore
  }
}

export function isCourseMapStale(slug: string): boolean {
  if (typeof window === 'undefined' || !slug) return false;
  try {
    return sessionStorage.getItem(STALE_PREFIX + slug) === '1';
  } catch {
    return false;
  }
}

export function clearCourseMapStale(slug: string): void {
  if (typeof window === 'undefined' || !slug) return;
  try {
    sessionStorage.removeItem(STALE_PREFIX + slug);
  } catch {
    // ignore
  }
}

export function courseSlugFromLessonLocation(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('course')?.trim() ?? '';
}
