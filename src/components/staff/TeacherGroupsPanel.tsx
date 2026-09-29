'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TeacherGroupDetailView } from '@/lib/teacher/group-detail';
import type { TeacherCabinetData, TeacherLessonView } from '@/lib/teacher/cabinet-data';
import type { StaffRunAction } from '@/lib/staff/run-action';
import StaffGroupPreview from './StaffGroupPreview';
import {
  formatGroupLessonDate,
  getGroupNextLesson,
  groupCardSubtitle,
  membersCountLabel,
} from './staff-directory-utils';
import TeacherGroupCard from './TeacherGroupCard';

type Props = {
  data: TeacherCabinetData;
  busy: boolean;
  runAction: StaffRunAction;
  onOpenStudent: (telegramId: number) => void;
  onOpenLesson: (lesson: TeacherLessonView) => void;
  onOpenSchedule?: () => void;
  initialGroupId?: number | null;
};

export default function TeacherGroupsPanel({
  data,
  busy,
  runAction,
  onOpenStudent,
  onOpenLesson,
  onOpenSchedule,
  initialGroupId,
}: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(initialGroupId ?? null);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<TeacherGroupDetailView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);

  const visibleGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data.groups;
    return data.groups.filter((group) => group.title.toLowerCase().includes(query));
  }, [data.groups, search]);

  const selectedListGroup =
    data.groups.find((group) => group.id === selectedId) ?? null;

  const loadGroup = useCallback(async (groupId: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cabinet/teacher/groups/${groupId}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Не удалось открыть группу');
      }
      setDetail((await res.json()) as TeacherGroupDetailView);
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : 'Не удалось открыть группу');
    } finally {
      setLoading(false);
    }
  }, []);

  const selectGroup = (groupId: number) => {
    setSelectedId(groupId);
    setGroupOpen(false);
    setDetail(null);
    setError(null);
  };

  const openGroupProfile = () => {
    if (selectedId == null) return;
    setGroupOpen(true);
    void loadGroup(selectedId);
  };

  const closeGroupProfile = () => {
    setGroupOpen(false);
  };

  const refreshDetail = async () => {
    if (selectedId == null) return;
    await loadGroup(selectedId);
  };

  const hasAside = Boolean(selectedListGroup);

  useEffect(() => {
    if (initialGroupId != null) {
      setSelectedId(initialGroupId);
      setGroupOpen(false);
      setDetail(null);
      setError(null);
    }
  }, [initialGroupId]);

  return (
    <div className={`staff-directory-page sched-page${hasAside ? ' has-aside' : ''}`}>
      <header className="staff-directory-head sched-head">
        <h1 className="sched-head-title">Группы</h1>
        <div className="staff-directory-toolbar sched-head-subrow">
          <label className="staff-directory-search">
            <span className="visually-hidden">Поиск группы</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск группы..."
            />
          </label>
        </div>
      </header>

      <div className="sched-body">
        <div className="staff-directory-main sched-main">
          {visibleGroups.length === 0 ? (
            <p className="staff-directory-empty">Группы не найдены.</p>
          ) : (
            <ul className="staff-directory-group-grid">
              {visibleGroups.map((group) => {
                const nextLesson = getGroupNextLesson(group);
                return (
                  <li key={group.id}>
                    <button
                      type="button"
                      className={`staff-directory-group-card${selectedId === group.id ? ' is-active' : ''}`}
                      onClick={() => selectGroup(group.id)}
                    >
                      <span className="staff-directory-group-kicker">Группа</span>
                      <strong className="staff-directory-group-title">{group.title}</strong>
                      <span className="staff-directory-group-sub">{groupCardSubtitle(group)}</span>
                      <span className="staff-directory-group-meta">{membersCountLabel(group.members.length)}</span>
                      <span className="staff-directory-group-next-label">Следующее занятие</span>
                      {nextLesson ? (
                        <span className="staff-directory-group-next">
                          {formatGroupLessonDate(nextLesson.startsAt)} · {nextLesson.time}
                        </span>
                      ) : (
                        <span className="staff-directory-group-next staff-directory-group-next--muted">
                          Не запланировано
                        </span>
                      )}
                      <span className="staff-directory-row-arrow" aria-hidden>
                        →
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectedListGroup ? (
          <StaffGroupPreview group={selectedListGroup} onOpenGroup={openGroupProfile} />
        ) : null}
      </div>

      {groupOpen && selectedId != null ? (
        <div className="staff-directory-overlay" role="dialog" aria-modal="true">
          <div className="staff-directory-overlay-panel">
            {loading ? <p className="staff-directory-empty">Загрузка…</p> : null}
            {!loading && error ? (
              <div className="schedule-detail-error">
                <p>{error}</p>
                <button type="button" className="sched-btn sched-btn--ghost" onClick={() => void loadGroup(selectedId)}>
                  Повторить
                </button>
              </div>
            ) : null}
            {!loading && detail ? (
              <TeacherGroupCard
                key={detail.id}
                group={detail}
                busy={busy}
                onClose={closeGroupProfile}
                onOpenStudent={onOpenStudent}
                onOpenLesson={onOpenLesson}
                onOpenSchedule={onOpenSchedule}
                runAction={async (action, successText, options) => {
                  const result = await runAction(action, successText, options);
                  await refreshDetail();
                  return result;
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
