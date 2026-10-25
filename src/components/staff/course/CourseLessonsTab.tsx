'use client';

import { useMemo, useState } from 'react';
import type { CuratorCabinetData, CuratorLessonView } from '@/lib/curator/cabinet-data';
import {
  curatorLessonDisplayNo,
  sessionLabel,
  sessionPillClass,
} from '@/components/curator/curator-utils';
import { IconChevronRightRef } from '../schedule/ScheduleRefIcons';
import {
  courseLessonStats,
  isLessonDone,
  isLessonUpcoming,
  lessonDateParts,
  lessonTime,
} from './course-utils';

type LessonFilter = 'all' | 'past' | 'upcoming';

const FILTERS: { id: LessonFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'past', label: 'Прошедшие' },
  { id: 'upcoming', label: 'Запланированные' },
];

type Props = {
  data: CuratorCabinetData;
  selectedLessonId: string | null;
  onSelectLesson: (id: string) => void;
};

function moduleOf(data: CuratorCabinetData, lesson: CuratorLessonView): number {
  return data.modules.findIndex((m) => m.lessonIds.includes(lesson.sanityId));
}

export default function CourseLessonsTab({ data, selectedLessonId, onSelectLesson }: Props) {
  const [filter, setFilter] = useState<LessonFilter>('all');
  const [moduleFilter, setModuleFilter] = useState<number | 'all'>('all');

  const stats = useMemo(() => courseLessonStats(data.lessons), [data.lessons]);

  const visible = useMemo(
    () =>
      data.lessons.filter((lesson) => {
        if (filter === 'past' && !isLessonDone(lesson)) return false;
        if (filter === 'upcoming' && !isLessonUpcoming(lesson)) return false;
        if (moduleFilter !== 'all' && moduleOf(data, lesson) !== moduleFilter) return false;
        return true;
      }),
    [data, filter, moduleFilter],
  );

  return (
    <div className="cr-lessons">
      <div className="cr-lessons-head">
        <h2 className="cr-h2">Все занятия курса</h2>
      </div>

      <div className="cr-toolbar">
        <div className="cr-filters" role="tablist" aria-label="Фильтр занятий">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={`cr-chip${filter === item.id ? ' is-active' : ''}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {data.modules.length > 1 ? (
          <select
            className="cr-select"
            aria-label="Модуль"
            value={moduleFilter === 'all' ? 'all' : String(moduleFilter)}
            onChange={(e) => setModuleFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">Все модули</option>
            {data.modules.map((mod, index) => (
              <option key={`${mod.title}-${index}`} value={index}>
                {mod.title}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="cr-empty">
          {data.lessons.length === 0 ? 'В курсе пока нет занятий.' : 'По выбранному фильтру занятий нет.'}
        </p>
      ) : (
        <ul className="cr-lesson-list">
          {visible.map((lesson) => {
            const parts = lessonDateParts(lesson.scheduledAt);
            const selected = lesson.sanityId === selectedLessonId;
            const materials = lesson.materials.length;
            const homework = lesson.homeworkFiles.length;
            return (
              <li key={lesson.sanityId}>
                <button
                  type="button"
                  className={`cr-lesson${selected ? ' is-selected' : ''}${isLessonDone(lesson) ? ' is-done' : ''}`}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelectLesson(lesson.sanityId)}
                >
                  <span className="cr-lesson-date">
                    {parts ? (
                      <>
                        <strong>{parts.day}</strong>
                        <em>{parts.month}</em>
                        <small>{parts.weekday}</small>
                      </>
                    ) : (
                      <>
                        <strong>—</strong>
                        <small>без даты</small>
                      </>
                    )}
                  </span>
                  <span className="cr-lesson-main">
                    <span className="cr-lesson-time">{lessonTime(lesson.scheduledAt)}</span>
                    <strong className="cr-lesson-title">
                      Урок {curatorLessonDisplayNo(lesson)}. {lesson.title}
                    </strong>
                    <span className="cr-lesson-meta">
                      {lesson.moduleTitle ? <span>{lesson.moduleTitle}</span> : null}
                      <span>Материалы ({materials})</span>
                      <span>ДЗ ({homework})</span>
                    </span>
                  </span>
                  <span className={`cr-pill ${sessionPillClass(lesson.sessionStatus)}`}>
                    {sessionLabel(lesson.sessionStatus)}
                  </span>
                  <span className="cr-lesson-go" aria-hidden="true">
                    <IconChevronRightRef size={16} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="cr-statbar">
        <h3 className="cr-statbar-title">Статистика курса</h3>
        <div className="cr-statbar-row">
          <div className="cr-statbar-item">
            <strong>{stats.done}</strong>
            <span>проведено занятий</span>
          </div>
          <div className="cr-statbar-item">
            <strong>{stats.remaining}</strong>
            <span>осталось занятий</span>
          </div>
          <div className="cr-statbar-item cr-statbar-progress">
            <span>Прогресс курса</span>
            <div className="cr-progress" aria-hidden="true">
              <i style={{ width: `${stats.percent}%` }} />
            </div>
            <strong>{stats.percent}%</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
