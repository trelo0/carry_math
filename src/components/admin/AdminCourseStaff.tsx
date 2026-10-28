'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AdminDialog } from '@/components/admin/AdminUi';
import type { CourseStaffData, StaffPerson, TeacherOption } from '@/lib/admin/course-staff-admin';

type RoleKey = 'teacher' | 'curator' | 'check';

const ROLES: Array<{ key: RoleKey; title: string; hint: string }> = [
  { key: 'teacher', title: 'Преподаватель', hint: 'Показывается в курсе и в кабинете (из Sanity, раздел «Наставник»).' },
  { key: 'curator', title: 'Куратор на эфирах', hint: 'Ведёт учеников в Telegram: домашки и жизни. Можно выбрать любого человека — он получит роли staff и куратор.' },
  { key: 'check', title: 'Проверяющий ДЗ', hint: 'Проверяет домашние задания по курсу. Можно выбрать любого человека — он получит роли staff и проверяющий.' },
];

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function hue(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function PersonCard({
  role,
  name,
  sub,
  seed,
  disabled,
  onChange,
  onRemove,
}: {
  role: (typeof ROLES)[number];
  name: string | null;
  sub: string | null;
  seed: string;
  disabled: boolean;
  onChange: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="admin-staff__card">
      <div className="admin-staff__role">
        <b>{role.title}</b>
        <span className="admin-sf__desc">{role.hint}</span>
      </div>
      {name ? (
        <div className="admin-staff__person">
          <span className="admin-stud__avatar" style={{ background: `hsl(${hue(seed)} 45% 38%)` }} aria-hidden>
            {initials(name)}
          </span>
          <span className="admin-staff__who">
            <span className="admin-stud__name">{name}</span>
            {sub ? <span className="admin-panel__cell-muted">{sub}</span> : null}
          </span>
        </div>
      ) : (
        <div className="admin-staff__empty">Не назначен</div>
      )}
      <div className="admin-staff__btns">
        <button type="button" className="admin-sf__btn" disabled={disabled} onClick={onChange}>
          {name ? 'Заменить' : 'Назначить'}
        </button>
        {name ? (
          <button type="button" className="admin-sf__btn admin-sf__btn--danger" disabled={disabled} onClick={onRemove}>
            Снять
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function AdminCourseStaff({
  courseId,
  sanityId,
  data,
  writeEnabled,
}: {
  courseId: number;
  sanityId: string;
  data: CourseStaffData;
  writeEnabled: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(data);
  const [rev, setRev] = useState(data.rev);
  const [dialog, setDialog] = useState<RoleKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'error'; text: string; details?: string[] } | null>(null);

  async function save(patch: { teacherId?: string | null; curatorTelegramId?: number | null; checkTelegramId?: number | null }) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/courses/staff', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, sanityId, rev, ...patch }),
      });
      const body = (await res.json()) as { error?: string; problems?: string[]; rev?: string | null };
      if (!res.ok) {
        setMsg({ type: 'error', text: body.error ?? 'Не удалось сохранить' });
        return false;
      }
      setRev(body.rev ?? null);
      setMsg({
        type: body.problems?.length ? 'error' : 'ok',
        text: body.problems?.length ? 'Сохранено в Sanity, но есть замечания по синхронизации:' : 'Сохранено и опубликовано',
        details: body.problems,
      });
      router.refresh();
      return true;
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Ошибка сети' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function assignTeacher(t: TeacherOption | null) {
    if (await save({ teacherId: t ? t.id : null })) setState((s) => ({ ...s, teacher: t }));
  }

  async function assignPerson(role: 'curator' | 'check', p: StaffPerson | null) {
    const ok = await save(role === 'curator' ? { curatorTelegramId: p ? p.telegramId : null } : { checkTelegramId: p ? p.telegramId : null });
    if (ok) setState((s) => ({ ...s, [role]: p }));
  }

  const disabled = busy || !writeEnabled;

  return (
    <section className="admin-form__card">
      <h3 className="admin-form__card-title">Сотрудники курса</h3>
      <p className="admin-sf__desc">Назначения сохраняются в Sanity и сразу синхронизируются с базой бота.</p>
      <div className="admin-staff">
        <PersonCard
          role={ROLES[0]}
          name={state.teacher?.name ?? null}
          sub={state.teacher?.subject ?? null}
          seed={state.teacher?.id ?? 'teacher'}
          disabled={disabled}
          onChange={() => setDialog('teacher')}
          onRemove={() => void assignTeacher(null)}
        />
        <PersonCard
          role={ROLES[1]}
          name={state.curator?.name ?? null}
          sub={state.curator ? `ID ${state.curator.telegramId} · ${state.curator.roles}` : null}
          seed={String(state.curator?.telegramId ?? 'curator')}
          disabled={disabled}
          onChange={() => setDialog('curator')}
          onRemove={() => void assignPerson('curator', null)}
        />
        <PersonCard
          role={ROLES[2]}
          name={state.check?.name ?? null}
          sub={state.check ? `ID ${state.check.telegramId} · ${state.check.roles}` : null}
          seed={String(state.check?.telegramId ?? 'check')}
          disabled={disabled}
          onChange={() => setDialog('check')}
          onRemove={() => void assignPerson('check', null)}
        />
      </div>
      {!writeEnabled ? (
        <p className="admin-sf__msg admin-sf__msg--error">Запись в Sanity отключена: не задан SANITY_API_WRITE_TOKEN.</p>
      ) : null}
      {msg ? (
        <div className="admin-cform__bar">
          <span className={`admin-sf__msg admin-sf__msg--${msg.type}`}>{msg.text}</span>
        </div>
      ) : null}
      {msg?.details?.length ? (
        <ul className="admin-sf__errors">
          {msg.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}

      <PickerDialog
        role={dialog}
        data={state}
        busy={busy}
        onClose={() => setDialog(null)}
        onPickTeacher={async (t) => {
          await assignTeacher(t);
          setDialog(null);
        }}
        onPickPerson={async (role, p) => {
          await assignPerson(role, p);
          setDialog(null);
        }}
      />
    </section>
  );
}

function PickerDialog({
  role,
  data,
  busy,
  onClose,
  onPickTeacher,
  onPickPerson,
}: {
  role: RoleKey | null;
  data: CourseStaffData;
  busy: boolean;
  onClose: () => void;
  onPickTeacher: (t: TeacherOption) => void;
  onPickPerson: (role: 'curator' | 'check', p: StaffPerson) => void;
}) {
  const [q, setQ] = useState('');
  const [manualId, setManualId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const title = role ? ROLES.find((r) => r.key === role)?.title ?? '' : '';

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.candidates.filter(
      (c) => !needle || c.name.toLowerCase().includes(needle) || String(c.telegramId).includes(needle),
    );
  }, [data.candidates, q]);

  const manual = Number(manualId.trim());
  const manualValid = Number.isInteger(manual) && manual > 0;
  const manualPerson = manualValid ? data.candidates.find((c) => c.telegramId === manual) : undefined;

  return (
    <AdminDialog open={role != null} onClose={onClose} title={role ? `Назначить: ${title}` : ''} busy={busy}>
      {role === 'teacher' ? (
        <>
          <p className="admin-sf__desc">Список из Sanity (документы «Наставник»). Выберите преподавателя курса.</p>
          {data.teachers.length === 0 ? (
            <p className="admin-sf__desc">В Sanity нет преподавателей.</p>
          ) : (
            <>
              <ul className="admin-staff__pick admin-staff__pick--tall">
                {data.teachers.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={`admin-staff__pick-row${teacherId === t.id ? ' is-active' : ''}`}
                      disabled={busy}
                      onClick={() => setTeacherId(t.id)}
                    >
                      <span className="admin-stud__avatar" style={{ background: `hsl(${hue(t.id)} 45% 38%)` }} aria-hidden>
                        {initials(t.name)}
                      </span>
                      <span className="admin-staff__who">
                        <span className="admin-stud__name">{t.name}</span>
                        {t.subject ? <span className="admin-panel__cell-muted">{t.subject}</span> : null}
                      </span>
                      {teacherId === t.id ? <span className="admin-staff__check" aria-hidden>✓</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="admin-dialog__actions">
                <button
                  type="button"
                  className="admin-sf__btn admin-sf__btn--primary"
                  disabled={busy || !teacherId}
                  onClick={() => {
                    const t = data.teachers.find((x) => x.id === teacherId);
                    if (t) onPickTeacher(t);
                  }}
                >
                  {busy ? 'Сохранение…' : 'Назначить'}
                </button>
              </div>
            </>
          )}
        </>      ) : role ? (
        <>
          <input
            className="admin-sf__input"
            placeholder="Поиск по имени или Telegram ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="admin-staff__pick admin-staff__pick--tall">
            {filtered.length === 0 ? <li className="admin-sf__desc">Никого не найдено.</li> : null}
            {filtered.slice(0, 60).map((c) => (
              <li key={c.telegramId}>
                <button type="button" className="admin-staff__pick-row" disabled={busy} onClick={() => onPickPerson(role, c)}>
                  <span className="admin-stud__avatar" style={{ background: `hsl(${hue(String(c.telegramId))} 45% 38%)` }} aria-hidden>
                    {initials(c.name)}
                  </span>
                  <span className="admin-staff__who">
                    <span className="admin-stud__name">{c.name}</span>
                    <span className="admin-panel__cell-muted">
                      ID {c.telegramId} · {c.roles}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="admin-sf__field">
            <span className="admin-sf__label">Или укажите Telegram ID</span>
            <div className="admin-dialog__inline">
              <input
                className="admin-sf__input"
                inputMode="numeric"
                placeholder="Например 123456789"
                value={manualId}
                onChange={(e) => setManualId(e.target.value.replace(/\D/g, ''))}
              />
              <button
                type="button"
                className="admin-sf__btn admin-sf__btn--primary"
                disabled={busy || !manualValid}
                onClick={() =>
                  onPickPerson(role, manualPerson ?? { telegramId: manual, name: `ID ${manual}`, roles: '' })
                }
              >
                Назначить
              </button>
            </div>
          </div>
        </>
      ) : null}
    </AdminDialog>
  );
}
