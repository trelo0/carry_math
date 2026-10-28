'use client';

import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import { AdminDialog, ConfirmDialog } from '@/components/admin/AdminUi';
import type { AdminCourseStudent, AdminStudentHomework } from '@/lib/admin/course-students';

const FMT_DATE = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Minsk' });
const FMT_DATETIME = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Minsk',
});

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : FMT_DATE.format(d);
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return 'нет активности';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : FMT_DATETIME.format(d);
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const HW_LABEL: Record<AdminStudentHomework['status'], string> = {
  approved: 'Принято',
  submitted: 'На проверке',
  rejected: 'Отклонено',
  revision: 'На доработке',
  waiting: 'Не сдано',
  upcoming: 'Впереди',
};

function Avatar({ s, size = 40 }: { s: AdminCourseStudent; size?: number }) {
  return (
    <span
      className="admin-stud__avatar"
      style={{ width: size, height: size, background: `hsl(${(s.telegramId * 47) % 360} 45% 38%)` }}
      aria-hidden
    >
      {initials(s.name)}
    </span>
  );
}

function Lives({ s }: { s: AdminCourseStudent }) {
  if (s.livesCurrent == null) return <span className="admin-panel__cell-muted">—</span>;
  return (
    <span className={`admin-stud__lives${s.livesCurrent === 0 ? ' is-zero' : ''}`}>
      <span aria-hidden>♥</span> {s.livesCurrent}/{s.livesMax ?? '?'}
    </span>
  );
}

function Profile({
  student,
  courseId,
  onChange,
}: {
  student: AdminCourseStudent;
  courseId: number;
  onChange: (patch: Partial<AdminCourseStudent>) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'error'; text: string; url?: string | null } | null>(null);

  async function act(action: 'life_add' | 'life_remove' | 'contact') {
    setBusy(action);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/courses/students/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, telegramId: student.telegramId, action }),
      });
      const body = (await res.json()) as {
        error?: string;
        livesCurrent?: number;
        livesMax?: number;
        accessBlocked?: boolean;
        changed?: boolean;
        url?: string | null;
      };
      if (!res.ok) {
        setMsg({ type: 'error', text: body.error ?? 'Не удалось выполнить действие' });
        return;
      }
      if (action === 'contact') {
        setMsg({ type: 'ok', text: 'Тема открыта в боте.', url: body.url });
        if (body.url) window.open(body.url, '_blank', 'noopener');
        return;
      }
      onChange({
        livesCurrent: body.livesCurrent ?? student.livesCurrent,
        livesMax: body.livesMax ?? student.livesMax,
        accessBlocked: body.accessBlocked ?? student.accessBlocked,
      });
      setMsg({ type: 'ok', text: body.changed === false ? 'Без изменений (лимит жизней).' : 'Жизни обновлены.' });
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Ошибка сети' });
    } finally {
      setBusy(null);
    }
  }

  const [topup, setTopup] = useState(false);
  const [lessons, setLessons] = useState(4);

  async function addPackage() {
    setBusy('package');
    setMsg(null);
    try {
      const res = await fetch('/api/admin/courses/students/package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, telegramId: student.telegramId, lessons }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg({ type: 'error', text: body.error ?? 'Не удалось пополнить пакет' });
        return;
      }
      onChange({ remainingPaidLessons: student.remainingPaidLessons + lessons });
      setMsg({ type: 'ok', text: `Пакет пополнен на ${lessons} зан.` });
      setTopup(false);
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Ошибка сети' });
    } finally {
      setBusy(null);
    }
  }

  const visibleHw = student.homeworks.filter((h) => h.status !== 'upcoming');
  const count = (...st: AdminStudentHomework['status'][]) => student.homeworks.filter((h) => st.includes(h.status)).length;
  return (
    <div className="admin-stud__profile">
      <div className="admin-stud__hero">
        <Avatar s={student} size={56} />
        <div>
          <div className="admin-stud__name">{student.name}</div>
          <div className="admin-panel__cell-muted">
            Telegram ID {student.telegramId}
            {student.phone ? ` · ${student.phone}` : ''}
          </div>
        </div>
      </div>

      <div className="admin-stud__progress-card">
        <div className="admin-stud__progress-top">
          <span>Прогресс по курсу</span>
          <b>
            {student.completedLessons}/{student.totalLessons} занятий · {student.progressPercent}%
          </b>
        </div>
        <div className="admin-stud__bar admin-stud__bar--lg">
          <i style={{ width: `${student.progressPercent}%` }} />
        </div>
      </div>

      <div className="admin-stud__tiles">
        <div className="admin-stud__tile is-ok">
          <b>{count('approved')}</b>
          <span>Сдано и принято</span>
        </div>
        <div className="admin-stud__tile is-info">
          <b>{count('submitted')}</b>
          <span>На проверке</span>
        </div>
        <div className="admin-stud__tile is-warn">
          <b>{count('rejected', 'revision')}</b>
          <span>На доработке</span>
        </div>
        <div className={`admin-stud__tile${student.overdueHomeworkCount > 0 ? ' is-bad' : ''}`}>
          <b>{student.overdueHomeworkCount}</b>
          <span>Просрочено</span>
        </div>
        <div className="admin-stud__tile">
          <b>{count('waiting')}</b>
          <span>Не сдано</span>
        </div>
        <div className="admin-stud__tile is-info">
          <b>{student.remainingPaidLessons}</b>
          <span>Занятий в пакете</span>
        </div>
      </div>

      <div className="admin-stud__meta">
        <span>
          Вступил на курс: <b>{fmtDate(student.enrolledAt)}</b>
        </span>
        <span>
          Последняя активность: <b>{fmtDateTime(student.lastActivityAt)}</b>
        </span>
      </div>

      <div className="admin-stud__block">
        <div className="admin-stud__block-head">
          <h4>Пакет занятий</h4>
          <button type="button" className="admin-sf__btn admin-sf__btn--primary" disabled={busy !== null} onClick={() => setTopup(true)}>
            + Пополнить пакет
          </button>
        </div>
        <p className="admin-sf__desc">
          Осталось оплаченных занятий: <b>{student.remainingPaidLessons}</b>. Если оплата не начислила занятия автоматически — выдайте их вручную.
        </p>
      </div>
      <div className="admin-stud__block">
        <div className="admin-stud__block-head">
          <h4>Жизни</h4>
          {student.fullyBlocked ? <span className="admin-stud__chip is-bad">Курс заблокирован</span> : null}
          {!student.fullyBlocked && student.accessBlocked ? (
            <span className="admin-stud__chip is-bad">Заморожен</span>
          ) : null}
        </div>
        <div className="admin-stud__lives-row">
          <button
            type="button"
            className="admin-sf__btn"
            disabled={busy !== null || (student.livesCurrent != null && student.livesCurrent <= 0)}
            onClick={() => void act('life_remove')}
          >
            − Снять жизнь
          </button>
          <span className="admin-stud__lives-big">
            <Lives s={student} />
          </span>
          <button
            type="button"
            className="admin-sf__btn"
            disabled={
              busy !== null ||
              (student.livesCurrent != null && student.livesMax != null && student.livesCurrent >= student.livesMax)
            }
            onClick={() => void act('life_add')}
          >
            + Добавить жизнь
          </button>
        </div>
      </div>

      <div className="admin-stud__block">
        <div className="admin-stud__block-head">
          <h4>Домашние задания</h4>
        </div>
        {visibleHw.length === 0 ? (
          <p className="admin-sf__desc">Пока нет доступных домашних заданий.</p>
        ) : (
          <ul className="admin-stud__hw">
            {visibleHw.map((h) => (
              <li key={`${h.number}-${h.title}`}>
                <span className="admin-stud__hw-num">{h.number}</span>
                <span className="admin-stud__hw-title">{h.title}</span>
                <span className={`admin-stud__chip is-${h.status}`}>{HW_LABEL[h.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={topup}
        tone="primary"
        title="Пополнить пакет"
        confirmLabel={`Выдать ${lessons} зан.`}
        busy={busy === 'package'}
        onClose={() => setTopup(false)}
        onConfirm={() => void addPackage()}
        text={
          <>
            <p>
              Ученику <b>{student.name}</b> будет выдан пакет занятий по этому курсу вручную. Занятия откроются так же, как после оплаты.
            </p>
            <div className="admin-stud__stepper">
              <button type="button" aria-label="Меньше" onClick={() => setLessons((n) => Math.max(1, n - 1))}>−</button>
              <input
                inputMode="numeric"
                value={lessons}
                onChange={(e) => setLessons(Math.min(100, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)))}
              />
              <button type="button" aria-label="Больше" onClick={() => setLessons((n) => Math.min(100, n + 1))}>+</button>
              <span>занятий</span>
            </div>
            <div className="admin-stud__presets">
              {[1, 4, 8, 12].map((n) => (
                <button key={n} type="button" className={lessons === n ? 'is-active' : ''} onClick={() => setLessons(n)}>
                  {n}
                </button>
              ))}
            </div>
          </>
        }
      />

      <div className="admin-stud__actions">
        <button
          type="button"
          className="admin-sf__btn admin-sf__btn--primary"
          disabled={busy !== null}
          onClick={() => void act('contact')}
        >
          {busy === 'contact' ? 'Открываю…' : 'Написать в Telegram'}
        </button>
        <Link href={`/cabinet/admin/people/${student.telegramId}`} className="admin-sf__btn" prefetch={false}>
          Полная карточка
        </Link>
        {msg ? (
          <span className={`admin-sf__msg admin-sf__msg--${msg.type}`}>
            {msg.text}
            {msg.url ? (
              <>
                {' '}
                <a href={msg.url} target="_blank" rel="noopener noreferrer">
                  Открыть
                </a>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function AdminCourseStudents({
  courseId,
  students: initial,
}: {
  courseId: number;
  students: AdminCourseStudent[];
}) {
  const [students, setStudents] = useState(initial);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const deferred = useDeferredValue(q);

  async function restoreAll() {
    setRestoring(true);
    setRestoreMsg(null);
    try {
      const res = await fetch('/api/admin/courses/students/restore-lives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId }),
      });
      const body = (await res.json()) as { error?: string; restored?: number; failed?: number };
      if (!res.ok) {
        setRestoreMsg({ type: 'error', text: body.error ?? 'Не удалось восстановить жизни' });
        return;
      }
      setStudents((list) =>
        list.map((s) =>
          s.livesCurrent != null && s.livesMax != null && !s.fullyBlocked ? { ...s, livesCurrent: s.livesMax, accessBlocked: false } : s,
        ),
      );
      setRestoreMsg({
        type: body.failed ? 'error' : 'ok',
        text: `Жизни восстановлены: ${body.restored ?? 0}${body.failed ? `, ошибок: ${body.failed}` : ''}`,
      });
      setRestoreOpen(false);
    } catch (e) {
      setRestoreMsg({ type: 'error', text: e instanceof Error ? e.message : 'Ошибка сети' });
    } finally {
      setRestoring(false);
    }
  }

  const filtered = useMemo(() => {
    const needle = deferred.trim().toLowerCase();
    if (!needle) return students;
    return students.filter((s) => s.name.toLowerCase().includes(needle) || String(s.telegramId).includes(needle));
  }, [students, deferred]);

  const active = students.find((s) => s.telegramId === openId) ?? null;

  return (
    <section className="admin-form__card">
      <div className="admin-prog__head">
        <div>
          <h3 className="admin-form__card-title">Ученики курса</h3>
          <p className="admin-sf__desc">Активных зачислений: {students.length}</p>
        </div>
        <div className="admin-stud__toolbar">
        <label className="admin-courses__search admin-stud__search">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input type="search" placeholder="Поиск ученика…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="button" className="admin-sf__btn admin-sf__btn--primary" disabled={students.length === 0} onClick={() => setRestoreOpen(true)}>
          ♥ Восстановить все жизни
        </button>
        </div>
      </div>
      {restoreMsg ? <p className={`admin-sf__msg admin-sf__msg--${restoreMsg.type}`}>{restoreMsg.text}</p> : null}

      {students.length === 0 ? (
        <div className="admin-panel__empty">
          <p className="admin-panel__empty-text">Нет активных зачислений на этот курс.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="admin-panel__empty">
          <p className="admin-panel__empty-text">Никого не найдено.</p>
        </div>
      ) : (
        <ul className="admin-stud__list">
          {filtered.map((s) => (
            <li key={s.telegramId}>
              <button type="button" className="admin-stud__row" onClick={() => setOpenId(s.telegramId)}>
                <Avatar s={s} />
                <span className="admin-stud__main">
                  <span className="admin-stud__name">{s.name}</span>
                  <span className="admin-panel__cell-muted">Активность: {fmtDateTime(s.lastActivityAt)}</span>
                </span>
                <span className="admin-stud__progress">
                  <span className="admin-stud__bar">
                    <i style={{ width: `${s.progressPercent}%` }} />
                  </span>
                  <span className="admin-panel__cell-muted">
                    {s.completedLessons}/{s.totalLessons} · {s.progressPercent}%
                  </span>
                </span>
                <Lives s={s} />
                {s.overdueHomeworkCount > 0 ? (
                  <span className="admin-stud__chip is-bad">ДЗ просрочено: {s.overdueHomeworkCount}</span>
                ) : null}
                <span className="admin-prog__chev" aria-hidden>
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={restoreOpen}
        tone="primary"
        title="Восстановить все жизни?"
        confirmLabel="Восстановить"
        busy={restoring}
        onClose={() => setRestoreOpen(false)}
        onConfirm={() => void restoreAll()}
        text={
          <>
            <p>Всем ученикам курса, у которых жизней меньше максимума, жизни будут восстановлены до полного значения.</p>
            <p>Ежемесячное автовосстановление при этом не блокируется. Полностью заблокированные курсы не затрагиваются.</p>
          </>
        }
      />

      <AdminDialog open={active != null} onClose={() => setOpenId(null)} title="Профиль ученика" wide>
        {active ? (
          <Profile
            key={active.telegramId}
            student={active}
            courseId={courseId}
            onChange={(patch) =>
              setStudents((list) => list.map((s) => (s.telegramId === active.telegramId ? { ...s, ...patch } : s)))
            }
          />
        ) : null}
      </AdminDialog>
    </section>
  );
}
