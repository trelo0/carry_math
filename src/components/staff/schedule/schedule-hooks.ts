import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';

function subscribeMinute(onChange: () => void): () => void {
  const id = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(id);
}

function minuteSnapshot(): number {
  return Math.floor(Date.now() / 60_000) * 60_000;
}

/** Текущее время (округлено до минуты). 0 — до гидратации на клиенте. */
export function useNowMs(): number {
  return useSyncExternalStore(subscribeMinute, minuteSnapshot, () => 0);
}

const MOBILE_QUERY = '(max-width: 768px)';

export type ScheduleSize = 'wide' | 'mid' | 'narrow';

/** Размер по ширине самого блока расписания (а не окна): сайдбар кабинета занимает место. */
export const SCHEDULE_WIDE_MIN = 960;
export const SCHEDULE_MID_MIN = 640;

export function scheduleSizeFor(width: number): ScheduleSize {
  if (width >= SCHEDULE_WIDE_MIN) return 'wide';
  if (width >= SCHEDULE_MID_MIN) return 'mid';
  return 'narrow';
}

/** Ширина элемента через ResizeObserver; 0 до первого замера. */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.round(el.getBoundingClientRect().width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function subscribeMediaQuery(query: string, onChange: () => void): () => void {
  const mq = window.matchMedia(query);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeMediaQuery(MOBILE_QUERY, onChange),
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}
