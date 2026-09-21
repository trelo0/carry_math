'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import type { CuratorCabinetData, CuratorHomeworkQueueItem } from '@/lib/curator/cabinet-data';
import CuratorDashboard from './CuratorDashboard';
import CuratorLessonsPanel from './CuratorLessonsPanel';
import CuratorStudentsPanel from './CuratorStudentsPanel';
import CuratorHomeworkPanel from './CuratorHomeworkPanel';
import CuratorSettingsPanel from './CuratorSettingsPanel';

export type CuratorSection = 'dashboard' | 'lessons' | 'students' | 'homework' | 'settings';

type Props = {
  data: CuratorCabinetData;
  initialSection?: CuratorSection;
  initialLessonId?: string;
  showCabinetPick?: boolean;
};

const SECTIONS: { id: CuratorSection; label: string }[] = [
  { id: 'dashboard', label: 'Главная' },
  { id: 'lessons', label: 'Занятия' },
  { id: 'students', label: 'Ученики' },
  { id: 'homework', label: 'Домашние задания' },
  { id: 'settings', label: 'Настройки' },
];

async function reloadData(): Promise<CuratorCabinetData> {
  const res = await fetch('/api/cabinet/curator/data', { cache: 'no-store' });
  if (!res.ok) throw new Error('Не удалось обновить данные');
  return res.json() as Promise<CuratorCabinetData>;
}

export default function CuratorShell({
  data: initialData,
  initialSection,
  initialLessonId,
  showCabinetPick,
}: Props) {
  const [data, setData] = useState(initialData);
  const [section, setSection] = useState<CuratorSection>(initialSection ?? 'dashboard');
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(initialLessonId ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectTarget, setRejectTarget] = useState<CuratorHomeworkQueueItem | null>(null);

  const refresh = useCallback(async () => {
    const next = await reloadData();
    setData(next);
  }, []);

  const runAction = useCallback(
    async (action: () => Promise<string | void>, successText?: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const resultText = await action();
        await refresh();
        setMessage(resultText ?? successText ?? null);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Ошибка');
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const hwQueueCount = data.homeworkQueue.length;

  return (
    <div className="curator-cabinet">
      <aside className="curator-sidebar">
        <div className="curator-brand">
          <span className="curator-brand-name">District</span>
          <span className="curator-brand-role">Куратор</span>
        </div>
        <nav className="curator-nav">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`curator-nav-btn${section === item.id ? ' is-active' : ''}`}
              onClick={() => {
                setSection(item.id);
                if (item.id !== 'lessons') setSelectedLessonId(null);
              }}
            >
              {item.label}
              {item.id === 'homework' && hwQueueCount > 0 ? (
                <span className="curator-badge">{hwQueueCount}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="curator-sidebar-foot">
          {showCabinetPick ? (
            <Link href="/cabinet/pick" className="curator-link curator-pick-link">
              Выбор кабинета
            </Link>
          ) : null}
          <p>{data.curatorName ?? 'Куратор'}</p>
          <p className="curator-muted">{data.courseTitle}</p>
        </div>
      </aside>

      <main className="curator-main">
        {message ? (
          <div className={`curator-toast${message.includes('Ошиб') ? ' is-error' : ''}`}>{message}</div>
        ) : null}
        {!data.sanityWriteEnabled ? (
          <div className="curator-warn">
            SANITY_API_WRITE_TOKEN не настроен — редактирование ссылок и файлов в Sanity недоступно.
          </div>
        ) : null}

        {section === 'dashboard' ? (
          <CuratorDashboard
            data={data}
            onOpenHomework={() => setSection('homework')}
            onOpenStudents={() => setSection('students')}
            onOpenLesson={(id) => {
              setSection('lessons');
              setSelectedLessonId(id);
            }}
          />
        ) : null}

        {section === 'lessons' ? (
          <CuratorLessonsPanel
            data={data}
            selectedLessonId={selectedLessonId}
            onSelectLesson={setSelectedLessonId}
            onBack={() => setSelectedLessonId(null)}
            busy={busy}
            runAction={runAction}
          />
        ) : null}

        {section === 'students' ? (
          <CuratorStudentsPanel students={data.students} busy={busy} runAction={runAction} />
        ) : null}

        {section === 'homework' ? (
          <CuratorHomeworkPanel
            board={data.homeworkBoard}
            busy={busy}
            rejectTarget={rejectTarget}
            rejectNote={rejectNote}
            onRejectNote={setRejectNote}
            onRejectTarget={setRejectTarget}
            onApprove={(item) =>
              runAction(async () => {
                const res = await fetch('/api/cabinet/curator/homework/approve', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    studentTelegramId: item.studentTelegramId,
                    lessonNumber: item.number,
                  }),
                });
                if (!res.ok) {
                  const body = (await res.json()) as { error?: string };
                  throw new Error(body.error ?? 'Не удалось принять');
                }
              }, 'Домашка принята')
            }
            onReject={(item) =>
              runAction(async () => {
                const res = await fetch('/api/cabinet/curator/homework/reject', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    studentTelegramId: item.studentTelegramId,
                    lessonNumber: item.number,
                    note: rejectNote.trim() || undefined,
                  }),
                });
                if (!res.ok) {
                  const body = (await res.json()) as { error?: string };
                  throw new Error(body.error ?? 'Не удалось отклонить');
                }
                setRejectTarget(null);
                setRejectNote('');
              }, 'Домашка отправлена на доработку')
            }
          />
        ) : null}

        {section === 'settings' ? (
          <CuratorSettingsPanel
            curatorName={data.curatorName}
            courseTitle={data.courseTitle}
            sanityWriteEnabled={data.sanityWriteEnabled}
          />
        ) : null}
      </main>
    </div>
  );
}
