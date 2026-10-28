import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminUserEventKind } from './user-activity-notify';

export const ADMIN_ACTIVITY_NOTIFICATION_KINDS: AdminUserEventKind[] = [
  'first_cabinet_login',
  'cabinet_login',
  'cta_course_signup',
  'course_map_first_view',
  'trial_lesson_first_view',
  'checkout_started',
  'course_purchase_paid',
];

export type ActivityNotificationSettingsMap = Record<AdminUserEventKind, boolean>;

function isSettingsTableMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string };
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  const msg = e.message ?? '';
  return msg.includes('admin_activity_notification_settings') || msg.includes('does not exist');
}

function defaultSettingsMap(): ActivityNotificationSettingsMap {
  return {
    first_cabinet_login: true,
    cabinet_login: true,
    cta_course_signup: true,
    course_map_first_view: true,
    trial_lesson_first_view: true,
    checkout_started: true,
    course_purchase_paid: true,
  };
}

export async function loadActivityNotificationSettings(
  admin: SupabaseClient,
): Promise<ActivityNotificationSettingsMap> {
  const map = defaultSettingsMap();
  const { data, error } = await admin
    .from('admin_activity_notification_settings')
    .select('kind, enabled');
  if (error) {
    if (isSettingsTableMissing(error)) return map;
    throw error;
  }
  for (const row of data ?? []) {
    const kind = row.kind as AdminUserEventKind;
    if (ADMIN_ACTIVITY_NOTIFICATION_KINDS.includes(kind)) {
      map[kind] = row.enabled === true;
    }
  }
  return map;
}

export async function isAdminActivityNotificationEnabled(
  admin: SupabaseClient,
  kind: AdminUserEventKind,
): Promise<boolean> {
  const map = await loadActivityNotificationSettings(admin);
  return map[kind] === true;
}

export async function setActivityNotificationEnabled(
  admin: SupabaseClient,
  kind: AdminUserEventKind,
  enabled: boolean,
): Promise<void> {
  if (!ADMIN_ACTIVITY_NOTIFICATION_KINDS.includes(kind)) {
    throw new Error('Unknown notification kind');
  }
  const { error } = await admin.from('admin_activity_notification_settings').upsert(
    {
      kind,
      enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'kind' },
  );
  if (error) throw error;
}
