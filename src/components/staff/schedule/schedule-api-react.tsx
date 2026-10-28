'use client';

import { createContext, useCallback, useContext } from 'react';
import { scheduleFetchWith, type ScheduleTeacherApiContext } from '@/lib/teacher/schedule-api-context';

const ScheduleApiReactContext = createContext<ScheduleTeacherApiContext | undefined>(undefined);

export const ScheduleApiProvider = ScheduleApiReactContext.Provider;

/** fetch для teacher-API; в админском расписании добавляет заголовок подмены. */
export function useScheduleFetch(): (input: string, init?: RequestInit) => Promise<Response> {
  const ctx = useContext(ScheduleApiReactContext);
  return useCallback((input, init) => scheduleFetchWith(ctx, input, init), [ctx]);
}
