'use client';

import { useCallback, useEffect, useState } from 'react';
import { ACTIVITY_NOTIFICATION_CARDS } from '@/lib/admin/activity-notification-catalog';
import type { AdminUserEventKind } from '@/lib/bot/admin/user-activity-notify';
import { Switch } from '@/components/admin/AdminUi';

type SettingsMap = Record<AdminUserEventKind, boolean>;

export default function AdminActivityNotifications() {
  const [settings, setSettings] = useState<SettingsMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingKind, setSavingKind] = useState<AdminUserEventKind | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/admin/settings/activity-notifications', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = (await res.json()) as { settings?: SettingsMap; error?: string };
      if (!res.ok) {
        setLoadError(data.error ?? 'Не удалось загрузить');
        return;
      }
      if (data.settings) setSettings(data.settings);
    } catch {
      setLoadError('Ошибка сети');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(kind: AdminUserEventKind, enabled: boolean) {
    if (!settings || savingKind) return;
    setSavingKind(kind);
    setSettings((current) => (current ? { ...current, [kind]: enabled } : current));
    try {
      const res = await fetch('/api/admin/settings/activity-notifications', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, enabled }),
      });
      const data = (await res.json()) as { settings?: SettingsMap; error?: string };
      if (!res.ok) {
        setSettings((current) =>
          current ? { ...current, [kind]: !enabled } : current,
        );
        setLoadError(data.error ?? 'Не удалось сохранить');
        return;
      }
      if (data.settings) setSettings(data.settings);
      setLoadError(null);
    } catch {
      setSettings((current) =>
        current ? { ...current, [kind]: !enabled } : current,
      );
      setLoadError('Ошибка сети при сохранении');
    } finally {
      setSavingKind(null);
    }
  }

  return (
    <div className="admin-sf__notify">
      <p className="admin-sf__cabinets-lead">
        Telegram-уведомления о действиях учеников на сайте. События по-прежнему сохраняются в базе; отключённый тип
        не отправляется в Telegram.
      </p>

      {loading ? (
        <p className="admin-sf__cabinets-lead" aria-live="polite">
          Загрузка настроек…
        </p>
      ) : null}

      {loadError ? <div className="admin-fin__notice admin-fin__notice--warn">{loadError}</div> : null}

      <div className="admin-sf__notify-grid">
        {ACTIVITY_NOTIFICATION_CARDS.map((card) => {
          const on = settings?.[card.kind] === true;
          const busy = savingKind === card.kind;
          return (
            <article
              key={card.kind}
              className={`admin-sf__notify-card admin-sf__notify-card--${card.accent}${on ? '' : ' is-muted'}`}
            >
              <div className="admin-sf__notify-card-head">
                <span className="admin-sf__notify-emoji" aria-hidden="true">
                  {card.emoji}
                </span>
                <div className="admin-sf__notify-toggle">
                  <Switch
                    checked={on}
                    onChange={(v) => void toggle(card.kind, v)}
                    disabled={loading || !settings || busy}
                    label={`${on ? 'Выключить' : 'Включить'}: ${card.title}`}
                  />
                  <span className="admin-sf__notify-toggle-label">{on ? 'Вкл.' : 'Выкл.'}</span>
                </div>
              </div>
              <h3>{card.title}</h3>
              <p>{card.description}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
