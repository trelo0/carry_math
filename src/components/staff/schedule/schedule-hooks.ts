import { useSyncExternalStore } from 'react';

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
const COMPACT_PANEL_QUERY = '(max-width: 1200px)';

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

/** Панель дня — выезжающий drawer, не колонка в сетке (≤1200px). */
export function useScheduleCompactPanel(): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeMediaQuery(COMPACT_PANEL_QUERY, onChange),
    () => window.matchMedia(COMPACT_PANEL_QUERY).matches,
    () => false,
  );
}
