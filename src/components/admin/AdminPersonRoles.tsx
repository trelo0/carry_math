'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RoleBadge } from '@/components/admin/AdminPeopleParts';
import { AdminDialog, AdminSelect } from '@/components/admin/AdminUi';
import type { PersonRoleBadge } from '@/lib/admin/people-data';
import { ASSIGNABLE_ROLES, ROLE_HINTS, ROLE_TITLES, isAssignableRole, type AssignableRole } from '@/lib/admin/people-roles';

type Props = {
  telegramId: number;
  roles: PersonRoleBadge[];
  primaryRole: string;
  extraRoles: string[];
};

export default function AdminPersonRoles({ telegramId, roles, primaryRole, extraRoles }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [primary, setPrimary] = useState<AssignableRole>(isAssignableRole(primaryRole) ? primaryRole : 'guest');
  const [extra, setExtra] = useState<AssignableRole[]>(extraRoles.filter(isAssignableRole));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setPrimary(isAssignableRole(primaryRole) ? primaryRole : 'guest');
    setExtra(extraRoles.filter(isAssignableRole));
    setError(null);
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/people/roles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId, primary, extra: extra.filter((r) => r !== primary) }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Не удалось сохранить роли');
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  }

  const additional = roles.slice(1);

  return (
    <>
      <div className="admin-person__role-stack">
        {roles[0] ? (
          <div className="admin-person__role-row">
            <span className="admin-person__role-label">Основная роль</span>
            <RoleBadge badge={roles[0]} />
          </div>
        ) : null}
        {additional.map((r) => (
          <div key={r.role} className="admin-person__role-row">
            <span className="admin-person__role-label">Дополнительная роль</span>
            <RoleBadge badge={r} />
          </div>
        ))}
        {additional.length === 0 && roles[0] ? (
          <p className="admin-person__role-empty">Дополнительных ролей нет</p>
        ) : null}
      </div>
      <button type="button" className="admin-person__wide-btn" onClick={openDialog}>
        Изменить роль
      </button>

      <AdminDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Изменить роль"
        busy={busy}
        footer={
          <>
            {error ? <span className="admin-sf__msg admin-sf__msg--error">{error}</span> : <span />}
            <div className="admin-dialog__actions">
              <button type="button" className="admin-sf__btn" disabled={busy} onClick={() => setOpen(false)}>
                Отмена
              </button>
              <button type="button" className="admin-sf__btn admin-sf__btn--primary" disabled={busy} onClick={() => void save()}>
                {busy ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </>
        }
      >
        <div className="admin-person__role-modal-section">
          <span className="admin-sf__label">Основная роль</span>
          <p className="admin-person__role-modal-hint">{ROLE_HINTS[primary]}</p>
          <AdminSelect
            label="Основная роль"
            value={primary}
            options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_TITLES[r] }))}
            onChange={(v) => {
              if (isAssignableRole(v)) {
                setPrimary(v);
                setExtra((list) => list.filter((r) => r !== v));
              }
            }}
            className="admin-select--block"
          />
        </div>
        <div className="admin-person__role-modal-section">
          <span className="admin-sf__label">Дополнительные роли</span>
          <p className="admin-person__role-modal-hint">
            Можно назначить несколько — права суммируются (как в боте: основная + extra_roles). Основную роль здесь
            повторно выбрать нельзя.
          </p>
          <div className="admin-roles-pick" role="group" aria-label="Дополнительные роли">
            {ASSIGNABLE_ROLES.filter((r) => r !== primary).map((r) => {
              const on = extra.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={on}
                  className={`admin-roles-pick__chip${on ? ' is-on' : ''}`}
                  title={ROLE_HINTS[r]}
                  onClick={() => setExtra((list) => (on ? list.filter((x) => x !== r) : [...list, r]))}
                >
                  <span className="admin-roles-pick__chip-mark" aria-hidden>
                    {on ? '✓' : '+'}
                  </span>
                  {ROLE_TITLES[r]}
                </button>
              );
            })}
          </div>
        </div>
      </AdminDialog>
    </>
  );
}
