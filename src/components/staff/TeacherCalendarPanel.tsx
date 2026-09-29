'use client';

import { useMemo, useState } from 'react';
import type { TeacherCabinetData, TeacherLessonView } from '@/lib/teacher/cabinet-data';
import { mergeDayTimeline } from '@/lib/teacher/lesson-utils';

type Props = {
  data: TeacherCabinetData;
  busy: boolean;
  runAction: (action: () => Promise<string | void>, successText?: string) => Promise<void>;
  onOpenStudent: (telegramId: number) => void;
  onOpenLesson: (lesson: TeacherLessonView) => void;
};

type KindTab = 'all' | 'individual' | 'group';

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function lessonOnDate(lesson: TeacherLessonView, d: Date): boolean {
  const x = new Date(lesson.startsAt);
  return (
    x.getFullYear() === d.getFullYear() &&
    x.getMonth() === d.getMonth() &&
    x.getDate() === d.getDate()
  );
}

function buildMonthGrid(month: Date): (Date | null)[] {
  const year = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(year, m, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, m, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function TeacherCalendarPanel({
  data,
  busy,
  runAction,
  onOpenStudent,
  onOpenLesson,
}: Props) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selected, setSelected] = useState<Date>(() => new Date());
  const [kindTab, setKindTab] = useState<KindTab>('all');
  const [freeStart, setFreeStart] = useState('10:00');
  const [freeEnd, setFreeEnd] = useState('12:00');
  const [lessonKind, setLessonKind] = useState<'individual' | 'group'>('individual');
  const [lessonTime, setLessonTime] = useState('10:00');
  const [lessonStudentId, setLessonStudentId] = useState('');
  const [lessonGroupId, setLessonGroupId] = useState('');
  const [lessonTopic, setLessonTopic] = useState('');

  const allLessons = useMemo(
    () =>
      [...data.individualLessons, ...data.groupLessons].sort((a, b) =>
        a.startsAt.localeCompare(b.startsAt),
      ),
    [data.individualLessons, data.groupLessons],
  );

  const filteredLessons = useMemo(() => {
    if (kindTab === 'individual') return data.individualLessons;
    if (kindTab === 'group') return data.groupLessons;
    return allLessons;
  }, [allLessons, data.groupLessons, data.individualLessons, kindTab]);

  const grid = useMemo(() => buildMonthGrid(month), [month]);
  const selectedKey = dateKey(selected);
  const dayLessons = filteredLessons.filter((l) => lessonOnDate(l, selected));
  const dayFreeSlots = data.daySlots.filter((s) => s.slotDate === selectedKey);
  const timeline = useMemo(
    () => mergeDayTimeline(dayLessons, dayFreeSlots),
    [dayLessons, dayFreeSlots],
  );

  const slotsByDate = useMemo(() => {
    const map = new Set<string>();
    for (const slot of data.daySlots) map.add(slot.slotDate);
    return map;
  }, [data.daySlots]);

  const shiftMonth = (delta: number) => {
    setMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const addFreeSlot = () => {
    if (freeStart >= freeEnd) {
      alert('Время начала должно быть раньше окончания');
      return;
    }
    void runAction(async () => {
      const res = await fetch('/api/cabinet/teacher/day-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotDate: selectedKey, startTime: freeStart, endTime: freeEnd }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось добавить окно');
      }
    }, 'Свободное окно добавлено');
  };

  const removeFreeSlot = (slotId: number) => {
    void runAction(async () => {
      const res = await fetch(`/api/cabinet/teacher/day-slots?slotId=${slotId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Не удалось удалить окно');
    }, 'Окно удалено');
  };

  const buildStartsAt = (time: string): string => {
    return new Date(`${selectedKey}T${time}:00`).toISOString();
  };

  const addLesson = () => {
    if (!lessonTime) {
      alert('Укажите время занятия');
      return;
    }
    if (lessonKind === 'individual' && !lessonStudentId) {
      alert('Выберите ученика');
      return;
    }
    if (lessonKind === 'group' && !lessonGroupId) {
      alert('Выберите группу');
      return;
    }

    void runAction(async () => {
      const startsAt = buildStartsAt(lessonTime);
      const payload =
        lessonKind === 'individual'
          ? {
              studentTelegramId: Number(lessonStudentId),
              kind: 'individual' as const,
              startsAt,
              topic: lessonTopic.trim() || undefined,
            }
          : {
              groupId: Number(lessonGroupId),
              kind: 'group' as const,
              startsAt,
              topic: lessonTopic.trim() || undefined,
            };

      const res = await fetch('/api/cabinet/teacher/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось назначить занятие');
      }
      setLessonTopic('');
    }, lessonKind === 'group' ? 'Групповое занятие назначено' : 'Занятие назначено');
  };

  const cancelLesson = (lesson: TeacherLessonView) => {
    if (!confirm(`Отменить занятие ${lesson.time} — ${lesson.topic}?`)) return;
    void runAction(async () => {
      const res = await fetch(`/api/cabinet/teacher/lessons/${lesson.id}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось отменить');
      }
    }, 'Занятие отменено');
  };

  const fillLessonFromFreeSlot = (startTime: string, endTime: string) => {
    setLessonTime(startTime);
    setFreeStart(startTime);
    setFreeEnd(endTime);
  };

  const weekdayLabel = WEEKDAYS[selected.getDay() === 0 ? 6 : selected.getDay() - 1];

  return (
    <div className="curator-panel teacher-calendar-panel">
      <header className="teacher-calendar-head">
        <div>
          <h1 className="curator-title">Расписание</h1>
          <p className="curator-muted">Выберите день и настройте занятия и свободные окна</p>
        </div>
        {data.nextLesson ? (
          <div className="teacher-next-inline">
            <span className="curator-muted">Ближайшее:</span>{' '}
            <strong>
              {data.nextLesson.date} {data.nextLesson.time}
            </strong>
            {' · '}
            <span className={`teacher-kind-badge kind-${data.nextLesson.kind}`}>
              {data.nextLesson.kind === 'group' ? 'Группа' : 'Индив.'}
            </span>
          </div>
        ) : null}
      </header>

      <div className="teacher-tabs" role="tablist">
        <button
          type="button"
          className={`teacher-tab${kindTab === 'all' ? ' is-active' : ''}`}
          onClick={() => setKindTab('all')}
        >
          Все
        </button>
        <button
          type="button"
          className={`teacher-tab${kindTab === 'individual' ? ' is-active' : ''}`}
          onClick={() => setKindTab('individual')}
        >
          Индивидуальные
        </button>
        <button
          type="button"
          className={`teacher-tab${kindTab === 'group' ? ' is-active' : ''}`}
          onClick={() => setKindTab('group')}
        >
          Групповые
        </button>
      </div>

      <div className="teacher-calendar-layout">
        <section className="curator-card teacher-calendar-main">
          <div className="teacher-calendar-nav">
            <button type="button" className="teacher-cal-nav-btn" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
              ←
            </button>
            <strong className="teacher-cal-month">
              {MONTHS[month.getMonth()]} {month.getFullYear()}
            </strong>
            <button type="button" className="teacher-cal-nav-btn" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
              →
            </button>
          </div>

          <div className="teacher-calendar-weekdays">
            {WEEKDAYS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>

          <div className="teacher-calendar-grid">
            {grid.map((day, index) => {
              if (!day) return <div key={`empty-${index}`} className="teacher-calendar-cell is-empty" />;
              const key = dateKey(day);
              const isSelected = key === selectedKey;
              const isToday = key === dateKey(new Date());
              const dayInd = data.individualLessons.filter((l) => lessonOnDate(l, day)).length;
              const dayGroup = data.groupLessons.filter((l) => lessonOnDate(l, day)).length;
              const hasFree = slotsByDate.has(key);
              const hasLessons = dayInd + dayGroup > 0;
              return (
                <button
                  key={key}
                  type="button"
                  className={`teacher-calendar-cell${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}${hasLessons ? ' has-lessons' : ''}${hasFree ? ' has-free' : ''}`}
                  onClick={() => setSelected(day)}
                >
                  <span className="teacher-calendar-day">{day.getDate()}</span>
                  {(dayInd > 0 || dayGroup > 0 || hasFree) && (
                    <span className="teacher-calendar-dots">
                      {dayInd > 0 ? <i className="dot-ind" title="Индивидуальные" /> : null}
                      {dayGroup > 0 ? <i className="dot-group" title="Групповые" /> : null}
                      {hasFree ? <i className="dot-free" title="Свободные окна" /> : null}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="curator-card teacher-calendar-side">
          <header className="teacher-day-head">
            <h2>
              {selected.getDate()} {MONTHS[selected.getMonth()]}
            </h2>
            <span className="teacher-day-weekday">{weekdayLabel}</span>
          </header>

          <div className="teacher-side-block">
            <h3>День</h3>
            {timeline.length === 0 ? (
              <p className="curator-muted">На этот день пока ничего не запланировано.</p>
            ) : (
              <ul className="teacher-day-timeline">
                {timeline.map((item) =>
                  item.type === 'free' ? (
                    <li key={`free-${item.id}`} className="timeline-free">
                      <div>
                        <span className="teacher-timeline-label">Свободно</span>
                        <strong>
                          {item.startTime}–{item.endTime}
                        </strong>
                      </div>
                      <div className="teacher-timeline-actions">
                        <button
                          type="button"
                          className="curator-link"
                          onClick={() => fillLessonFromFreeSlot(item.startTime, item.endTime)}
                        >
                          В занятие
                        </button>
                        <button
                          type="button"
                          className="curator-link"
                          disabled={busy}
                          onClick={() => removeFreeSlot(item.id)}
                        >
                          Удалить
                        </button>
                      </div>
                    </li>
                  ) : (
                    <li key={`lesson-${item.lesson.id}`} className={`timeline-lesson kind-${item.lesson.kind}`}>
                      <div>
                        <span className={`teacher-kind-badge kind-${item.lesson.kind}`}>
                          {item.lesson.kind === 'group' ? 'Группа' : 'Индив.'}
                        </span>
                        <strong>{item.lesson.time}</strong>
                        <span>{item.lesson.topic}</span>
                        {item.lesson.kind === 'individual' ? (
                          item.lesson.studentTelegramId ? (
                            <button
                              type="button"
                              className="curator-link"
                              onClick={() => onOpenStudent(item.lesson.studentTelegramId!)}
                            >
                              {item.lesson.studentName ?? item.lesson.studentTelegramId}
                            </button>
                          ) : (
                            <span className="curator-muted">Без ученика</span>
                          )
                        ) : (
                          <span className="curator-muted">{item.lesson.groupTitle ?? 'Группа'}</span>
                        )}
                      </div>
                      <div className="teacher-timeline-actions">
                        <button type="button" className="curator-btn curator-btn--primary" onClick={() => onOpenLesson(item.lesson)}>
                          Открыть
                        </button>
                        {item.lesson.isUpcoming ? (
                          <button type="button" className="curator-link" disabled={busy} onClick={() => cancelLesson(item.lesson)}>
                            Отменить
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ),
                )}
              </ul>
            )}
          </div>

          <div className="teacher-side-block teacher-side-block--lesson">
            <h3>Добавить занятие</h3>
            <p className="curator-muted">На {selected.getDate()} {MONTHS[selected.getMonth()]}</p>
            <div className="teacher-form-row">
              <label>
                Тип
                <select
                  value={lessonKind}
                  onChange={(e) => {
                    setLessonKind(e.target.value as 'individual' | 'group');
                    setLessonStudentId('');
                    setLessonGroupId('');
                  }}
                >
                  <option value="individual">Индивидуальное</option>
                  <option value="group">Групповое</option>
                </select>
              </label>
              <label>
                Время
                <input type="time" value={lessonTime} onChange={(e) => setLessonTime(e.target.value)} />
              </label>
              {lessonKind === 'individual' ? (
                <label>
                  Ученик
                  <select value={lessonStudentId} onChange={(e) => setLessonStudentId(e.target.value)}>
                    <option value="">Выберите ученика</option>
                    {data.students.map((student) => (
                      <option key={student.telegramId} value={student.telegramId}>
                        {student.name ?? `ID ${student.telegramId}`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  Группа
                  <select value={lessonGroupId} onChange={(e) => setLessonGroupId(e.target.value)}>
                    <option value="">Выберите группу</option>
                    {data.groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.title} ({group.members.length})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Тема
                <input
                  type="text"
                  value={lessonTopic}
                  onChange={(e) => setLessonTopic(e.target.value)}
                  placeholder="Необязательно"
                />
              </label>
            </div>
            <button type="button" className="curator-btn curator-btn--primary" disabled={busy} onClick={addLesson}>
              Добавить занятие
            </button>
          </div>

          <div className="teacher-side-block">
            <h3>Свободное окно</h3>
            <p className="curator-muted">Время без занятия — доступны для записи.</p>
            <div className="teacher-form-row">
              <label>
                С <input type="time" value={freeStart} onChange={(e) => setFreeStart(e.target.value)} />
              </label>
              <label>
                До <input type="time" value={freeEnd} onChange={(e) => setFreeEnd(e.target.value)} />
              </label>
            </div>
            <button type="button" className="curator-btn curator-btn--primary" disabled={busy} onClick={addFreeSlot}>
              Добавить окно
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
