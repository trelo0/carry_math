/** Префикс API расписания; для админки — отдельные маршруты с `teacherTelegramId` в теле/query. */
export type ScheduleTeacherApiContext = {
  prefix: string;
  teacherTelegramId: number;
};

const DEFAULT_PREFIX = '/api/cabinet/teacher';

export const ACT_AS_TEACHER_HEADER = 'x-admin-act-as-teacher';

export function scheduleTeacherApiPath(
  ctx: ScheduleTeacherApiContext | undefined,
  subpath: string,
): string {
  const prefix = ctx?.prefix ?? DEFAULT_PREFIX;
  const path = subpath.startsWith('/') ? subpath : `/${subpath}`;
  return `${prefix}${path}`;
}

export function withScheduleTeacherPayload(
  ctx: ScheduleTeacherApiContext | undefined,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (ctx?.teacherTelegramId != null) {
    return { ...payload, teacherTelegramId: ctx.teacherTelegramId };
  }
  return payload;
}

export function scheduleAllowsSeries(ctx: ScheduleTeacherApiContext | undefined): boolean {
  return !ctx?.teacherTelegramId;
}

/** fetch к `/api/cabinet/teacher/*`; в админке добавляет заголовок «от имени преподавателя». */
export function scheduleFetchWith(
  ctx: ScheduleTeacherApiContext | undefined,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  if (ctx?.teacherTelegramId == null) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set(ACT_AS_TEACHER_HEADER, String(ctx.teacherTelegramId));
  return fetch(input, { ...init, headers });
}
