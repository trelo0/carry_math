'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CabinetAchievementView } from '@/lib/cabinet-achievements';

const PAGE_SIZE = 4;

type Props = {
  achievements: CabinetAchievementView[];
  unlockedCount: number;
  trackingEnabled: boolean;
};

function Icon({ d, strokeWidth = 1.4 }: { d: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} aria-hidden="true">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS = {
  trophy: 'M8 21h8M12 17v4M7 4h10v3a5 5 0 0 1-10 0V4z M9 4V2h6v2',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3 M6 11h12v10H6z',
  chevron: 'M9 6l6 6-6 6',
};

function chunkAchievements(items: CabinetAchievementView[]): CabinetAchievementView[][] {
  const pages: CabinetAchievementView[][] = [];
  for (let i = 0; i < items.length; i += PAGE_SIZE) {
    pages.push(items.slice(i, i + PAGE_SIZE));
  }
  return pages;
}

export default function CabinetAchievementSlider({
  achievements,
  unlockedCount,
  trackingEnabled,
}: Props) {
  const pages = useMemo(() => chunkAchievements(achievements), [achievements]);
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    setPageIndex((prev) => Math.min(prev, Math.max(0, pages.length - 1)));
  }, [pages.length]);

  const goPage = useCallback(
    (dir: -1 | 1) => {
      setPageIndex((prev) => {
        const next = prev + dir;
        if (next < 0) return 0;
        if (next >= pages.length) return pages.length - 1;
        return next;
      });
    },
    [pages.length],
  );

  if (achievements.length === 0) return null;

  return (
    <section className="cab-panel cab-achieve-panel">
      <header className="cab-panel-head cab-achieve-head">
        <div className="cab-achieve-head-text">
          <h3 className="cab-achieve-title-row">
            Достижения
            <span className="cab-achieve-head-meta">
              {trackingEnabled
                ? `${unlockedCount}/${achievements.length}`
                : 'после оплаты'}
            </span>
          </h3>
        </div>
        {pages.length > 1 ? (
          <div className="cab-achieve-nav">
            <button
              type="button"
              className="cab-achieve-nav-btn is-next"
              aria-label="Вперёд"
              disabled={pageIndex >= pages.length - 1}
              onClick={() => goPage(1)}
            >
              <Icon d={ICONS.chevron} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="cab-achieve-nav-btn is-prev"
              aria-label="Назад"
              disabled={pageIndex <= 0}
              onClick={() => goPage(-1)}
            >
              <Icon d={ICONS.chevron} strokeWidth={2} />
            </button>
          </div>
        ) : null}
      </header>
      <div className="cab-achieve-slider-wrap">
        <div
          className="cab-achieve-track"
          style={{ transform: `translateX(-${pageIndex * 100}%)` }}
        >
          {pages.map((page, pi) => (
            <div key={`page-${pi}`} className="cab-achieve-page">
              <div className="cab-achieve cab-achieve--ref">
                {page.map((item, index) => (
                  <div
                    key={`${item.ruleKey}-${item.title}-${index}`}
                    className={`cab-ach${item.unlocked ? ' is-unlocked' : ''}${!trackingEnabled ? ' is-dormant' : ''}`}
                  >
                    <span className="cab-badge-hex">
                      <Icon d={item.unlocked ? ICONS.trophy : ICONS.lock} />
                    </span>
                    <span className="cab-ach-text">
                      <strong>{item.title}</strong>
                      <em>{item.subtitle}</em>
                    </span>
                    <div className="cab-ach-popover" role="tooltip">
                      <p>{item.subtitle}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
