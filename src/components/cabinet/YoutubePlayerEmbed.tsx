'use client';

import { useEffect, useRef } from 'react';

type YtPlayer = {
  destroy: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
};

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: {
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: () => void;
            onStateChange?: (e: { data: number }) => void;
          };
        },
      ) => YtPlayer;
      PlayerState?: { PLAYING: number; PAUSED: number; ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoadPromise: Promise<void> | null = null;

function loadYoutubeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!document.querySelector('script[data-yt-iframe-api]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.ytIframeApi = '1';
      document.head.appendChild(script);
    }
    // Уже загружен между вызовами
    const check = setInterval(() => {
      if (window.YT?.Player) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });
  return apiLoadPromise;
}

export default function YoutubePlayerEmbed({
  videoId,
  title,
  autoplay = true,
  disableNativeFullscreen = false,
  onWatchPercent,
}: {
  videoId: string;
  title: string;
  autoplay?: boolean;
  disableNativeFullscreen?: boolean;
  /** Вызывается с max % (не чаще чем раз в ~5с и только при росте). */
  onWatchPercent?: (percent: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const maxPctRef = useRef(0);
  const lastSentRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      await loadYoutubeApi();
      if (cancelled || !hostRef.current || !window.YT?.Player) return;

      const player = new window.YT.Player(hostRef.current, {
        videoId,
        playerVars: {
          autoplay: autoplay ? 1 : 0,
          rel: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          playsinline: 1,
          fs: disableNativeFullscreen ? 0 : 1,
        },
        events: {
          onReady: () => {
            pollTimer = setInterval(() => {
              try {
                const duration = player.getDuration();
                if (!duration || duration <= 0) return;
                const current = player.getCurrentTime();
                const pct = Math.min(100, Math.round((current / duration) * 100));
                if (pct > maxPctRef.current) {
                  maxPctRef.current = pct;
                }
                // Шлём при росте на ≥5 п.п. или на 90/100
                const max = maxPctRef.current;
                const shouldSend =
                  max >= lastSentRef.current + 5 ||
                  (max >= 90 && lastSentRef.current < 90) ||
                  (max >= 100 && lastSentRef.current < 100);
                if (shouldSend && onWatchPercent) {
                  lastSentRef.current = max;
                  onWatchPercent(max);
                }
              } catch {
                /* player not ready */
              }
            }, 5000);
          },
          onStateChange: (e) => {
            const ended = window.YT?.PlayerState?.ENDED ?? 0;
            if (e.data === ended) {
              maxPctRef.current = 100;
              if (lastSentRef.current < 100) {
                lastSentRef.current = 100;
                onWatchPercent?.(100);
              }
            }
          },
        },
      });
      playerRef.current = player;
    })();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [videoId, autoplay, disableNativeFullscreen, onWatchPercent]);

  return (
    <div className="cab-lesson-v2-frame cab-lesson-v2-yt" title={title}>
      <div ref={hostRef} className="cab-lesson-v2-yt-host" />
    </div>
  );
}
