'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CabinetAchievementView } from '@/lib/cabinet-achievements';

const STORAGE_PREFIX = 'cab-ach-seen:';

type ToastItem = {
  ruleKey: string;
  title: string;
  subtitle: string;
};

type Props = {
  storageKey: string;
  achievements: CabinetAchievementView[];
  enabled: boolean;
};

export default function CabinetAchievementToasts({ storageKey, achievements, enabled }: Props) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seededRef = useRef(false);

  const unlockedSignature = useMemo(
    () =>
      achievements
        .filter((a) => a.unlocked)
        .map((a) => a.ruleKey)
        .sort()
        .join('\u0001'),
    [achievements],
  );

  useEffect(() => {
    if (!storageKey || !enabled) return;

    const unlockedKeys = unlockedSignature ? unlockedSignature.split('\u0001') : [];
    const storageId = STORAGE_PREFIX + storageKey;
    let seen: string[] = [];

    try {
      const raw = localStorage.getItem(storageId);
      if (raw) seen = JSON.parse(raw) as string[];
    } catch {
      seen = [];
    }

    if (!seededRef.current && seen.length === 0 && unlockedKeys.length > 0) {
      localStorage.setItem(storageId, JSON.stringify(unlockedKeys));
      seededRef.current = true;
      return;
    }

    const newlyUnlocked = unlockedKeys.filter((k) => !seen.includes(k));
    if (newlyUnlocked.length > 0) {
      const byKey = new Map(achievements.map((a) => [a.ruleKey, a]));
      const nextToasts = newlyUnlocked
        .map((ruleKey) => byKey.get(ruleKey as CabinetAchievementView['ruleKey']))
        .filter(Boolean)
        .map((a) => ({
          ruleKey: a!.ruleKey,
          title: a!.title,
          subtitle: a!.subtitle,
        }));

      if (nextToasts.length > 0) {
        setToasts((prev) => [...prev, ...nextToasts]);
      }

      const merged = [...new Set([...seen, ...newlyUnlocked])];
      localStorage.setItem(storageId, JSON.stringify(merged));
    }

    seededRef.current = true;
  }, [storageKey, unlockedSignature, achievements, enabled]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const head = toasts[0]!;
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.ruleKey !== head.ruleKey));
    }, 5200);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  if (!enabled || toasts.length === 0) return null;

  return (
    <div className="cab-achievement-toasts" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.ruleKey} className="cab-achievement-toast" role="status">
          <div className="cab-achievement-toast-glow" aria-hidden="true" />
          <div className="cab-achievement-toast-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path
                d="M8 21h8M12 17v4M7 4h10v3a5 5 0 0 1-10 0V4z M9 4V2h6v2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="cab-achievement-toast-body">
            <span className="cab-achievement-toast-kicker">Новое достижение</span>
            <strong className="cab-achievement-toast-title">{item.title}</strong>
            <span className="cab-achievement-toast-sub">{item.subtitle}</span>
          </div>
          <div className="cab-achievement-toast-progress" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}
