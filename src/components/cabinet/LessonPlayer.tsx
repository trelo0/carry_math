'use client';

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { SanityWebinarSessionStatus } from '@/lib/curator/lesson-session';
import { buildYoutubeEmbedUrl, extractYoutubeVideoId } from '@/lib/youtube';

export type LessonPlayerPhase = 'upcoming' | 'live' | 'recording' | 'waiting';

const PLAY_PATH = 'M9 6.5v11l9-5.5-9-5.5z';
const LIVE_DURATION_MIN = 90;
const TICK_MS = 30_000;

function subscribeTick(onChange: () => void) {
  const timer = setInterval(onChange, TICK_MS);
  return () => clearInterval(timer);
}

/** Текущее время с шагом 30 с: на сервере — null, чтобы разметка совпала при гидрации. */
function useNow(): number | null {
  return useSyncExternalStore(
    subscribeTick,
    () => Math.floor(Date.now() / TICK_MS) * TICK_MS,
    () => null,
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PLAY_PATH} />
    </svg>
  );
}

/** Фаза занятия: до начала — превью, во время — эфир, после — запись. */
export function resolveLessonPhase(
  now: number | null,
  sessionStartsAt: string | null,
  recordingUrl: string | null,
  durationMinutes = LIVE_DURATION_MIN,
  webinarSessionStatus?: SanityWebinarSessionStatus | null,
): LessonPlayerPhase {
  if (webinarSessionStatus === 'live') return 'live';
  if (webinarSessionStatus === 'completed') return recordingUrl ? 'recording' : 'upcoming';
  if (webinarSessionStatus === 'waiting') return 'waiting';
  if (webinarSessionStatus === 'scheduled') return 'upcoming';

  if (now == null) return recordingUrl && !sessionStartsAt ? 'recording' : 'upcoming';
  const start = sessionStartsAt ? Date.parse(sessionStartsAt) : NaN;
  if (Number.isNaN(start)) return recordingUrl ? 'recording' : 'upcoming';
  if (now < start) return 'upcoming';
  if (now < start + durationMinutes * 60_000) return 'live';
  return 'recording';
}

function vimeoId(url: string): string | null {
  const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return match?.[1] ?? null;
}

type Media = { kind: 'iframe' | 'video'; src: string };

/** Ссылка на видео → встраиваемый источник (YouTube / Vimeo / прямой файл). */
export function toEmbedMedia(url: string | null, disableNativeFullscreen = false): Media | null {
  if (!url) return null;
  const yt = extractYoutubeVideoId(url);
  if (yt) {
    return {
      kind: 'iframe',
      src: buildYoutubeEmbedUrl(yt, true, { disableNativeFullscreen }),
    };
  }
  const vm = vimeoId(url);
  if (vm) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vm}?autoplay=1` };
  if (/\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(url)) return { kind: 'video', src: url };
  return { kind: 'iframe', src: url };
}

function startLabel(sessionStartsAt: string | null, phase: LessonPlayerPhase): string {
  if (phase === 'waiting') return 'Ожидаем начала трансляции';
  if (!sessionStartsAt) return 'Дата вебинара уточняется';
  const date = new Date(sessionStartsAt);
  if (Number.isNaN(date.getTime())) return 'Дата вебинара уточняется';
  return `Начало ${date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export default function LessonPlayer({
  title,
  tag = 'Математика',
  sessionStartsAt,
  liveUrl,
  recordingUrl,
  posterUrl,
  durationMinutes = LIVE_DURATION_MIN,
  onPlay,
  onNavigate,
  disableNativeFullscreen = false,
  webinarSessionStatus = null,
  children,
}: {
  title: string;
  tag?: string;
  sessionStartsAt: string | null;
  liveUrl: string | null;
  recordingUrl: string | null;
  posterUrl?: string | null;
  durationMinutes?: number;
  webinarSessionStatus?: SanityWebinarSessionStatus | null;
  onPlay?: (phase: LessonPlayerPhase) => void;
  /** Если задан — кнопка Play открывает страницу занятия вместо встроенного плеера. */
  onNavigate?: () => void;
  /** Скрывает кнопку fullscreen у YouTube — для режима «видео + чат». */
  disableNativeFullscreen?: boolean;
  children?: ReactNode;
}) {
  const now = useNow();
  const [manualPlay, setManualPlay] = useState(false);

  const phase = resolveLessonPhase(
    now,
    sessionStartsAt,
    recordingUrl,
    durationMinutes,
    webinarSessionStatus,
  );
  const sourceUrl =
    phase === 'live'
      ? liveUrl ?? null
      : phase === 'recording'
        ? recordingUrl ?? liveUrl
        : null;
  const media = useMemo(
    () => toEmbedMedia(sourceUrl, disableNativeFullscreen),
    [sourceUrl, disableNativeFullscreen],
  );
  // эфир стартует сам, запись — по кнопке
  const playing = (manualPlay || (phase === 'live' && !!liveUrl)) && !!media;

  function start() {
    if (onNavigate) {
      onNavigate();
      return;
    }
    if (!media) return;
    setManualPlay(true);
    onPlay?.(phase);
  }

  const posterStyle = posterUrl
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(4, 8, 16, 0.06) 0%, rgba(4, 8, 16, 0.62) 100%), url('${posterUrl}')`,
      }
    : undefined;

  return (
    <div className="cab-lesson-v2-player">
      <div className={`cab-lesson-v2-poster${playing ? ' is-playing' : ''}`} style={posterStyle}>
        {playing && media ? (
          media.kind === 'video' ? (
            <video className="cab-lesson-v2-frame" src={media.src} controls autoPlay playsInline />
          ) : (
            <iframe
              className="cab-lesson-v2-frame"
              src={media.src}
              title={title}
              allow={
                disableNativeFullscreen
                  ? 'accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture'
                  : 'accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen'
              }
              {...(disableNativeFullscreen ? {} : { allowFullScreen: true })}
            />
          )
        ) : (
          <>
            <span className="cab-lesson-v2-poster-tag">{tag}</span>
            <p className="cab-lesson-v2-poster-title">{title}</p>
            {phase === 'live' && (
              <span className="cab-lesson-v2-live" aria-hidden="true">
                <i /> В эфире
              </span>
            )}
            {(media || onNavigate) && (
              <button
                type="button"
                className="cab-lesson-v2-play"
                aria-label={
                  onNavigate
                    ? 'Открыть занятие'
                    : phase === 'live'
                      ? 'Смотреть трансляцию'
                      : 'Смотреть запись'
                }
                onClick={start}
              >
                <PlayIcon />
              </button>
            )}
            {!media && (phase === 'upcoming' || phase === 'waiting') && (
              <span className="cab-lesson-v2-soon">{startLabel(sessionStartsAt, phase)}</span>
            )}
          </>
        )}
      </div>
      {children}
    </div>
  );
}
