/** Callback data для admin ops жизней (≤64 байт). */

export function livesMenuCb(studentTelegramId: number, courseId?: number | null): string {
  return courseId != null ? `al:m:${studentTelegramId}:${courseId}` : `al:m:${studentTelegramId}`;
}

export function livesGrantCb(studentTelegramId: number, courseId: number): string {
  return `al:g:${studentTelegramId}:${courseId}`;
}

export function livesDeductCb(studentTelegramId: number, courseId: number): string {
  return `al:d:${studentTelegramId}:${courseId}`;
}

export function livesHistoryCb(studentTelegramId: number, courseId: number): string {
  return `al:h:${studentTelegramId}:${courseId}`;
}

export function livesUnfreezeCb(studentTelegramId: number, courseId: number): string {
  return `al:u:${studentTelegramId}:${courseId}`;
}

export function livesBlockAskCb(studentTelegramId: number, courseId: number, blocked: boolean): string {
  return `al:b:${studentTelegramId}:${courseId}:${blocked ? '1' : '0'}`;
}

export function livesBlockConfirmCb(
  studentTelegramId: number,
  courseId: number,
  blocked: boolean,
): string {
  return `al:b:${studentTelegramId}:${courseId}:${blocked ? '1' : '0'}:c`;
}

export function livesRefundCb(studentTelegramId: number, courseId: number, yes: boolean): string {
  return `al:rf:${studentTelegramId}:${courseId}:${yes ? 'yes' : 'no'}`;
}

export function livesMonthlyRestoreCb(courseId?: number | null): string {
  return courseId != null ? `al:rm:${courseId}` : 'al:rm';
}

export function parseLivesOpsCourseId(parts: string[], action: string): number | null {
  if (parts.length < 4) return null;
  const raw = parts[3];
  if (action === 'rf' && (raw === 'yes' || raw === 'no')) return null;
  if (action === 'b' && (raw === '0' || raw === '1') && parts.length < 5) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseLivesBlockAction(
  parts: string[],
  fallbackCourseId: number | null,
): { courseId: number | null; blocked: boolean; confirm: boolean } {
  if (parts[3] === '0' || parts[3] === '1') {
    return {
      courseId: fallbackCourseId,
      blocked: parts[3] === '1',
      confirm: parts[4] === 'c',
    };
  }
  return {
    courseId: Number(parts[3]),
    blocked: parts[4] === '1',
    confirm: parts[5] === 'c',
  };
}

export function parseLivesRefundAction(
  parts: string[],
): { courseId: number | null; refundYes: boolean } {
  if (parts[3] === 'yes' || parts[3] === 'no') {
    return { courseId: null, refundYes: parts[3] === 'yes' };
  }
  const courseId = Number(parts[3]);
  return {
    courseId: Number.isFinite(courseId) && courseId > 0 ? courseId : null,
    refundYes: parts[4] === 'yes',
  };
}
