'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CabinetCourseStop } from '@/lib/cabinet';
import { DEFAULT_LESSON_CONTENT_CHIPS } from '@/lib/studio/courseContent';
import { extractYoutubeVideoId } from '@/lib/youtube';
import LessonPlayer from '@/components/cabinet/LessonPlayer';
import YoutubeLiveChat from '@/components/cabinet/YoutubeLiveChat';


type LessonFile = {
  title: string;
  fileName: string | null;
  fileSize: string | null;
  url: string | null;
};

type Props = {
  stop: CabinetCourseStop;
  coverUrl: string | null;
};

function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className} aria-hidden="true">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS = {
  lock: 'M7 11V8a5 5 0 0 1 10 0v3 M6 11h12v10H6z',
  file: 'M8 4h8l4 4v12H8z M14 4v4h4',
  download: 'M12 3v12 M7 13l5 5 5-5 M5 21h14',
  expand: 'M8 3H5a2 2 0 0 0-2 2v3 M16 3h3a2 2 0 0 1 2 2v3 M21 16v3a2 2 0 0 1-2 2h-3 M8 21H5a2 2 0 0 1-2-2v-3',
  collapse: 'M4 14h6v6H4z M14 4h6v6h-6z M14 14h6v6h-6z M4 4h6v6H4z',
};

function LessonFileList({ files }: { files: LessonFile[] }) {
  if (!files.length) {
    return (
      <div className="cab-lespage-files-empty">
        <Icon d={ICONS.lock} />
        <p>Файлы появятся после публикации.</p>
      </div>
    );
  }

  return (
    <ul className="cab-lespage-files">
      {files.map((f) => {
        const name = f.fileName ?? f.title;
        return (
          <li key={`${name}-${f.url ?? 'locked'}`} className="cab-lespage-file">
            <Icon d={ICONS.file} className="cab-lespage-file-ico" />
            <span className="cab-lespage-file-name">{name}</span>
            {f.fileSize && <em>{f.fileSize}</em>}
            {f.url ? (
              <a
                href={f.url}
                className="cab-lespage-file-dl"
                aria-label={`Скачать ${name}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon d={ICONS.download} />
              </a>
            ) : (
              <button type="button" className="cab-lespage-file-dl" aria-label={`Скачать ${name}`} disabled>
                <Icon d={ICONS.download} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LessonStream({
  stop,
  coverUrl,
  hasLiveChat,
  isFullscreen,
  onToggleFullscreen,
  onPlay,
}: {
  stop: CabinetCourseStop;
  coverUrl: string | null;
  hasLiveChat: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onPlay: (watchPhase: 'upcoming' | 'live' | 'recording' | 'waiting') => void;
}) {
  return (
    <div className="cab-lespage-stream">
      <div className="cab-lespage-video-wrap">
        <LessonPlayer
          title={stop.title}
          sessionStartsAt={stop.sessionStartsAt}
          liveUrl={stop.liveUrl}
          recordingUrl={stop.recordingUrl}
          posterUrl={coverUrl}
          webinarSessionStatus={stop.webinarSessionStatus}
          disableNativeFullscreen={hasLiveChat}
          onPlay={onPlay}
        />
        <div className="cab-lespage-video-meta">
          <span>
            {stop.status === 'watched' || stop.status === 'done'
              ? 'Просмотрено полностью'
              : 'Просмотр не начат'}
          </span>
          <span className="cab-lespage-video-meta-right">
            <span>
              {stop.webinarSessionStatus === 'live'
                ? 'Трансляция'
                : stop.webinarSessionStatus === 'completed'
                  ? stop.recordingUrl
                    ? 'Запись'
                    : 'Завершено'
                  : stop.webinarSessionStatus === 'waiting'
                    ? 'Ожидание эфира'
                    : stop.recordingUrl
                      ? 'Запись'
                      : stop.liveUrl
                        ? 'Запланировано'
                        : 'Скоро'}
            </span>
            {hasLiveChat && (
              <button
                type="button"
                className="cab-lespage-fullscreen-btn"
                aria-label={isFullscreen ? 'Выйти из полноэкранного режима' : 'На весь экран с чатом'}
                aria-pressed={isFullscreen}
                onClick={onToggleFullscreen}
              >
                <Icon d={isFullscreen ? ICONS.collapse : ICONS.expand} />
                {isFullscreen ? 'Свернуть' : 'На весь экран'}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function CabinetLessonDetail({ stop, coverUrl }: Props) {
  const router = useRouter();
  const theaterRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const chips =
    stop.contentChips?.filter(Boolean).length ? stop.contentChips.filter(Boolean) : DEFAULT_LESSON_CONTENT_CHIPS;

  const isLiveSession = stop.webinarSessionStatus === 'live';
  const youtubeLiveId = extractYoutubeVideoId(stop.liveUrl) ?? extractYoutubeVideoId(stop.recordingUrl);
  const hasLiveChat = Boolean(youtubeLiveId && stop.liveUrl && isLiveSession);

  useEffect(() => {
    const sync = () => {
      setIsFullscreen(document.fullscreenElement === theaterRef.current);
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  useEffect(() => {
    const usingFallback = isFullscreen && document.fullscreenElement !== theaterRef.current;
    if (!usingFallback) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(async () => {
    const el = theaterRef.current;
    if (!el) return;

    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      setIsFullscreen((value) => !value);
    }
  }, []);

  async function markLessonWatched(watchPhase: 'upcoming' | 'live' | 'recording' | 'waiting') {
    if (!stop.sanityLessonId) return;
    const endpoint = watchPhase === 'live' ? 'watch-live' : 'watch-recording';
    await fetch(`/api/cabinet/course/lessons/${encodeURIComponent(stop.sanityLessonId)}/${endpoint}`, {
      method: 'POST',
    });
    router.refresh();
  }

  const stream = (
    <LessonStream
      stop={stop}
      coverUrl={coverUrl}
      hasLiveChat={hasLiveChat}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
      onPlay={markLessonWatched}
    />
  );

  return (
    <div className={`cab-lespage-content${hasLiveChat ? ' cab-lespage-content--with-chat' : ''}`}>
      {hasLiveChat && youtubeLiveId ? (
        <div
          ref={theaterRef}
          className={`cab-lespage-theater${isFullscreen ? ' is-fullscreen' : ''}`}
        >
          {stream}
          <YoutubeLiveChat videoId={youtubeLiveId} />
        </div>
      ) : (
        stream
      )}

      <section className="cab-lespage-about">
        <h2>О чём занятие</h2>
        <p>{stop.description?.trim() || 'Описание появится позже.'}</p>
        <ul className="cab-lespage-chips" aria-label="Содержание занятия">
          {chips.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </section>

      <section className="cab-lespage-materials">
        <h2>Материалы к занятию</h2>
        <LessonFileList files={stop.materials} />
      </section>

      <section className="cab-lespage-homework">
        <h2>Домашнее задание</h2>
        <LessonFileList files={stop.homeworkFiles} />
      </section>
    </div>
  );
}
