import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import AdminPersonRoles from '@/components/admin/AdminPersonRoles';
import { PersonAvatar } from '@/components/admin/AdminPeopleParts';
import { getAdminCabinetContext } from '@/lib/admin/auth';
import {
  cabinetProfileFilled,
  formatCabinetProfileResult,
  loadAdminPersonDetailCached,
} from '@/lib/admin/people-data';

export const dynamic = 'force-dynamic';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="admin-person__row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

const PACKAGE_STATUS: Record<string, string> = {
  active: 'Активен',
  completed: 'Использован',
  expired: 'Истёк',
  cancelled: 'Отменён',
};

export default async function AdminPersonPage({ params }: { params: Promise<{ telegramId: string }> }) {
  const { telegramId: raw } = await params;
  const telegramId = Number(raw);
  if (!Number.isFinite(telegramId)) notFound();

  const ctx = await getAdminCabinetContext();
  if (!ctx) redirect('/cabinet');

  const person = await loadAdminPersonDetailCached(telegramId);
  if (!person) notFound();

  const cp = person.cabinetProfile;
  const profileFilled = cabinetProfileFilled(cp);

  return (
    <div className="admin-person">
      <Link href="/cabinet/admin/people" className="admin-panel__back-link" prefetch={false}>
        ← Назад
      </Link>

      <div className="admin-person__head">
        <PersonAvatar telegramId={telegramId} name={person.name} size="lg" />
        <div className="admin-person__titles">
          <h2 className="admin-person__name">{person.name}</h2>
          <p className="admin-person__meta">
            {person.phone ?? '—'} <span aria-hidden>•</span> ID: {telegramId}
          </p>
        </div>
      </div>

      <div className="admin-person__bento">
        <section className="admin-form__card admin-person__bento-cell admin-person__bento-span">
          <h3 className="admin-form__card-title">Личные данные</h3>
          <div className="admin-person__personal-split">
            <div className="admin-person__personal-col">
              <p className="admin-person__subsection">Учётная запись</p>
              <Row label="Имя в Telegram" value={person.memberFullName} />
              <Row label="Телефон" value={person.phone ?? '—'} />
              <Row label="Telegram ID" value={telegramId} />
              <Row label="Дата регистрации" value={formatDate(person.registeredAt)} />
            </div>
            <div className="admin-person__personal-col">
              <p className="admin-person__subsection">Из личного кабинета</p>
              {!profileFilled ? (
                <p className="admin-panel__cell-muted admin-person__cabinet-empty">
                  Ученик ещё не заполнил профиль в кабинете
                </p>
              ) : (
                <>
                  <Row label="Имя" value={cp?.displayName ?? '—'} />
                  <Row
                    label="Класс"
                    value={cp?.schoolClass ? `${cp.schoolClass} класс` : '—'}
                  />
                  <Row label="Цель обучения" value={cp?.goal ?? '—'} />
                  <Row label="Текущая успеваемость" value={formatCabinetProfileResult(cp)} />
                </>
              )}
            </div>
          </div>
        </section>

        <section className="admin-form__card admin-person__bento-cell">
          <h3 className="admin-form__card-title">Роль</h3>
          <AdminPersonRoles
            key={`${person.primaryRole}:${person.extraRoles.join(',')}`}
            telegramId={telegramId}
            roles={person.roles}
            primaryRole={person.primaryRole}
            extraRoles={person.extraRoles}
          />
        </section>

        <section className="admin-form__card admin-person__bento-cell">
          <h3 className="admin-form__card-title">Последние действия</h3>
          {person.recentActions.length === 0 ? (
            <p className="admin-panel__cell-muted">Действий пока нет</p>
          ) : (
            <div className="admin-person__actions-list">
              {person.recentActions.map((a) => (
                <div key={a.id} className="admin-person__action">
                  <span className="admin-person__action-dot" aria-hidden />
                  <span>
                    <span className="admin-courses__course-title">{a.title}</span>
                    <span className="admin-courses__num-sub">{a.whenLabel}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="admin-form__card admin-person__bento-cell">
          <h3 className="admin-form__card-title">Курсы ({person.courses.length})</h3>
          {person.courses.length === 0 ? (
            <p className="admin-panel__cell-muted">Нет зачислений</p>
          ) : (
            person.courses.map((c) => (
              <Link
                key={c.courseId}
                href={`/cabinet/admin/courses/${c.courseId}/students`}
                className="admin-person__course"
                prefetch={false}
              >
                <span
                  className="admin-courses__icon"
                  style={{ background: `hsl(${(c.courseId * 53) % 360} 55% 42%)` }}
                >
                  {c.title.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <span className="admin-courses__course-title">{c.title}</span>
                  <span className="admin-courses__num-sub">С {formatDate(c.startedAt)}</span>
                </span>
              </Link>
            ))
          )}
        </section>

        <section className="admin-form__card admin-person__bento-cell">
          <h3 className="admin-form__card-title">Пакеты ({person.packages.length})</h3>
          {person.packages.length === 0 ? (
            <p className="admin-panel__cell-muted">Пакетов нет</p>
          ) : (
            person.packages.map((p) => (
              <div key={p.id} className="admin-person__row">
                <span className="admin-person__package-line">
                  <span className="admin-courses__course-title">{p.title}</span>
                  <span className="admin-courses__num-sub">{PACKAGE_STATUS[p.status] ?? p.status}</span>
                </span>
                <span>
                  {p.remaining ?? '?'} / {p.total ?? '?'} зан.
                </span>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
