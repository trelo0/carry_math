'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import HomeworkRowChip from '@/components/cabinet/HomeworkRowChip';
import {
  buildCourseHomeworkStatusTelegramStart,
  buildCourseHomeworkTelegramStart,
} from '@/lib/bot/course-homework-deeplink';
import { homeworkLockedActionHint, homeworkRowState } from '@/lib/cabinet-homework-row';
import type { CabinetCourseStop } from '@/lib/cabinet';

const SUPPORT_EMAIL = 'district.school.210@gmail.com';

const ICONS = {
  homework: 'M6 2h9l5 5v15H6V2z M14 2v6h6 M9 13h6 M9 17h6',
  file: 'M6 2h9l5 5v15H6V2z M14 2v6h6',
  info: 'M12 8v4 M12 16h.01 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  clock: 'M12 7v5l3 3 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
} as const;

function Icon({
  d,
  className,
  strokeWidth = 1.7,
}: {
  d: string;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function tgBotUrl(start: string): string {
  const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  return username
    ? `https://t.me/${username}?start=${encodeURIComponent(start)}`
    : `mailto:${SUPPORT_EMAIL}`;
}

function formatLessonDate(date: string | null | undefined): string {
  if (!date) return '—';
  const dotted = date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const parsed = dotted
    ? new Date(Number(dotted[3]), Number(dotted[2]) - 1, Number(dotted[1]))
    : new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function lessonsLabel(count: number): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${count} занятий`;
  const mod10 = count % 10;
  if (mod10 === 1) return `${count} занятие`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} занятия`;
  return `${count} занятий`;
}

export type CourseHomeworkModule = {
  name: string;
  color: string;
  count: number;
};

type Props = {
  modules: CourseHomeworkModule[];
  stops: CabinetCourseStop[];
  hasCourse: boolean;
  homeworkIntro?: string | null;
  onHomeworkInteraction?: () => void;
};

function HomeworkCardAction({
  stop,
  hw,
  onInteract,
}: {
  stop: CabinetCourseStop;
  hw: ReturnType<typeof homeworkRowState>;
  onInteract?: () => void;
}) {
  const click = onInteract;
  if (hw.action === 'view' && stop.sanityLessonId) {
    return (
      <a
        className="cab-hw-card-action is-active"
        href={tgBotUrl(buildCourseHomeworkStatusTelegramStart(stop.sanityLessonId))}
        target="_blank"
        rel="noopener noreferrer"
        onClick={click}
      >
        <Icon d={ICONS.file} />
        Посмотреть ответ
      </a>
    );
  }
  if (hw.action === 'view') {
    return (
      <span className="cab-hw-card-action is-locked">
        <Icon d={ICONS.file} />
        Посмотреть ответ
      </span>
    );
  }
  if (hw.action === 'locked') {
    return (
      <span className="cab-hw-card-action is-locked">
        <Icon d={ICONS.file} />
        <span className="cab-hw-card-action-text">
          {homeworkLockedActionHint(hw.label, stop)}
        </span>
      </span>
    );
  }
  if (hw.action === 'check_status' && stop.sanityLessonId) {
    return (
      <a
        className="cab-hw-card-action is-active"
        href={tgBotUrl(buildCourseHomeworkStatusTelegramStart(stop.sanityLessonId))}
        target="_blank"
        rel="noopener noreferrer"
        onClick={click}
      >
        <Icon d={ICONS.homework} />
        Проверить статус
      </a>
    );
  }
  if (hw.action === 'submit' && stop.sanityLessonId) {
    return (
      <a
        className="cab-hw-card-action is-active"
        href={tgBotUrl(buildCourseHomeworkTelegramStart(stop.sanityLessonId))}
        target="_blank"
        rel="noopener noreferrer"
        onClick={click}
      >
        <Icon d={ICONS.homework} />
        Сдать ДЗ в Telegram
      </a>
    );
  }
  return null;
}

export default function CourseHomeworkPanel({
  modules,
  stops,
  hasCourse,
  homeworkIntro,
  onHomeworkInteraction,
}: Props) {
  const [activeModule, setActiveModule] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const stopsByModule = useMemo(() => {
    const map = new Map<number, CabinetCourseStop[]>();
    for (const s of stops) {
      const list = map.get(s.module) ?? [];
      list.push(s);
      map.set(s.module, list);
    }
    return map;
  }, [stops]);

  const scrollToModule = useCallback((moduleIndex: number) => {
    setActiveModule(moduleIndex);
    const el = scrollRef.current?.querySelector<HTMLElement>(`#cab-hw-mod-${moduleIndex}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (modules.length === 0 && stops.length === 0) {
    return (
      <div className="cab-hw-panel">
        <p className="cab-hw-empty">Домашние задания появятся вместе с программой курса.</p>
      </div>
    );
  }

  return (
    <div className="cab-hw-panel">
      <header className="cab-hw-head">
        <div className="cab-hw-head-main">
          <h3>
            <Icon d={ICONS.homework} />
            Домашние задания
          </h3>
          {homeworkIntro?.trim() ? <p>{homeworkIntro.trim()}</p> : null}
        </div>
        <span className="cab-hw-info">
          <Icon d={ICONS.info} strokeWidth={1.6} />
          ДЗ открываются после прохождения вебинара
        </span>
      </header>

      {modules.length > 0 ? (
        <div className="cab-hw-mod-slider" role="tablist" aria-label="Модули курса">
          {modules.map((mod, mi) => (
            <button
              key={mod.name + mi}
              type="button"
              role="tab"
              aria-selected={activeModule === mi}
              className={`cab-hw-mod-slide${activeModule === mi ? ' is-active' : ''}`}
              onClick={() => scrollToModule(mi)}
            >
              <span className="cab-hw-mod-slide-top">
                <span className="cab-hw-mod-slide-code">M{mi + 1}</span>
                <span className="cab-hw-mod-slide-title">{`Модуль ${mi + 1}`}</span>
              </span>
              <span className="cab-hw-mod-slide-sub">{mod.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="cab-hw-scroll" ref={scrollRef}>
        {modules.map((mod, mi) => {
          const moduleStops = stopsByModule.get(mi) ?? [];
          return (
            <section
              key={mod.name + mi}
              id={`cab-hw-mod-${mi}`}
              className="cab-hw-mod-section"
              style={{ ['--cab-hw-mod-color' as string]: mod.color }}
            >
              <header className="cab-hw-mod-head">
                <span
                  className="cab-hw-mod-head-dot"
                  style={{ background: mod.color }}
                  aria-hidden="true"
                />
                <h4>{`Модуль ${mi + 1}. ${mod.name}`}</h4>
                <span className="cab-hw-mod-head-count">{lessonsLabel(mod.count)}</span>
              </header>
              <div className="cab-hw-mod-cards">
                {moduleStops.length === 0 ? (
                  <p className="cab-hw-mod-empty">Занятия этого модуля появятся в программе курса.</p>
                ) : null}
                {moduleStops.map((s) => {
                  const hw = homeworkRowState(s, hasCourse);
                  return (
                    <article key={s.id} className={`cab-hw-card is-${hw.tone}`}>
                      <div className="cab-hw-card-num" aria-hidden="true">
                        {String(s.numInModule).padStart(2, '0')}
                      </div>
                      <div className="cab-hw-card-main">
                        <strong>{s.title}</strong>
                        <p className="cab-hw-card-meta">
                          <Icon d={ICONS.clock} className="cab-hw-card-meta-ico" />
                          <span>Вебинар</span>
                          <span className="cab-hw-dot" aria-hidden="true">
                            •
                          </span>
                          <span>{formatLessonDate(s.date)}</span>
                        </p>
                      </div>
                      <div className="cab-hw-card-aside">
                        <HomeworkRowChip
                          row={hw}
                          isJoinArchive={s.isJoinArchive}
                          homeworkStatus={s.homeworkStatus}
                          homeworkDeadlineAt={s.homeworkDeadlineAt}
                          homeworkRemainingMs={s.homeworkRemainingMs}
                          homeworkOverdueAt={s.homeworkOverdueAt}
                          trackDeadline={hasCourse && !(s.isTrialFree && !hasCourse)}
                        />
                        <HomeworkCardAction
                          stop={s}
                          hw={hw}
                          onInteract={onHomeworkInteraction}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
