import type { SupabaseClient } from '@supabase/supabase-js';
import { runHomeworkDeadlineReminders } from './homework-deadline-notify';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastSweepAt = 0;
let sweepInFlight: Promise<void> | null = null;

/** Периодический проход напоминаний ДЗ без cron (throttle ~5 мин на инстанс). */
export function scheduleHomeworkDeadlineSweep(admin: SupabaseClient): void {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  if (sweepInFlight) return;

  lastSweepAt = now;
  sweepInFlight = runHomeworkDeadlineReminders(admin, new Date(), { limit: 200 })
    .then(() => undefined)
    .catch((err) => {
      console.error('[hw-deadline] opportunistic sweep failed:', err);
    })
    .finally(() => {
      sweepInFlight = null;
    });
}
