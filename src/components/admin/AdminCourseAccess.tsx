'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import AdminCourseDocForm from '@/components/admin/AdminCourseDocForm';
import { ConfirmDialog, Switch } from '@/components/admin/AdminUi';
import type { FormField, SanityDocValues } from '@/lib/admin/sanity-form-types';

type Props = {
  sanityId: string;
  courseId: number;
  title: string;
  fields: FormField[];
  doc: SanityDocValues;
  writeEnabled: boolean;
};

function Card({
  tone,
  icon,
  title,
  text,
  checked,
  onChange,
  disabled,
  stateOn,
  stateOff,
}: {
  tone: 'open' | 'closed';
  icon: React.ReactNode;
  title: string;
  text: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  stateOn: string;
  stateOff: string;
}) {
  return (
    <div className={`admin-acc__card admin-acc__card--${tone}${checked ? ' is-on' : ''}`}>
      <span className="admin-acc__icon" aria-hidden>
        {icon}
      </span>
      <div className="admin-acc__body">
        <h4 className="admin-acc__title">{title}</h4>
        <p className="admin-acc__text">{text}</p>
      </div>
      <div className="admin-acc__switch">
        <Switch checked={checked} onChange={onChange} disabled={disabled} label={title} />
        <span className="admin-acc__state">{checked ? stateOn : stateOff}</span>
      </div>
    </div>
  );
}

export default function AdminCourseAccess({ sanityId, courseId, title, fields, doc, writeEnabled }: Props) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/courses/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'course', id: sanityId, courseId }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Не удалось удалить курс');
        return;
      }
      router.push('/cabinet/admin/courses');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminCourseDocForm
        key={sanityId}
        scope="access"
        fields={fields}
        doc={doc}
        id={sanityId}
        writeEnabled={writeEnabled}
        refreshOnSave
        layout={({ ctx, bar }) => (
          <>
            <section className="admin-form__card">
              <h3 className="admin-form__card-title">Доступ к курсу</h3>
              <div className="admin-acc">
                <Card
                  tone="open"
                  title="Доступ для новых"
                  text="Курс виден в каталоге, новые ученики могут его купить. Если выключить — курс «Закрытый»: новые ученики не попадут, а текущие продолжат учиться."
                  checked={ctx.values.showInCatalog !== false}
                  disabled={ctx.disabled}
                  stateOn="Открыт"
                  stateOff="Закрыт для новых"
                  onChange={(v) => ctx.setField('showInCatalog', v)}
                  icon={
                    <svg viewBox="0 0 24 24" width="22" height="22">
                      <path d="M5 11V8a7 7 0 0 1 13.5-2.6M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  }
                />
                <Card
                  tone="closed"
                  title="Закрыт полностью (архив)"
                  text="Курс скрывается из кабинета для всех, включая тех, кто учился раньше. В истории остаются только оплаты."
                  checked={ctx.values.courseClosed === true}
                  disabled={ctx.disabled}
                  stateOn="В архиве"
                  stateOff="Работает"
                  onChange={(v) => ctx.setField('courseClosed', v)}
                  icon={
                    <svg viewBox="0 0 24 24" width="22" height="22">
                      <path d="M4 7h16v3H4V7Zm1 3v9h14v-9M10 14h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  }
                />
              </div>
              <div className="admin-cform__savebar admin-cform__savebar--flat">{bar}</div>
            </section>

            <div className="admin-danger-compact">
              <span className="admin-sf__desc">
                Полное удаление курса из Sanity (модули и занятия). Необратимо — для скрытия используйте «Закрыт полностью».
              </span>
              <button
                type="button"
                className="admin-sf__btn admin-sf__btn--danger"
                disabled={!writeEnabled}
                onClick={() => {
                  setError(null);
                  setConfirm(true);
                }}
              >
                Удалить курс
              </button>
            </div>
          </>
        )}
      />
      <ConfirmDialog
        open={confirm}
        title="Удалить курс?"
        confirmLabel="Удалить навсегда"
        requireText={title}
        busy={busy}
        error={error}
        onClose={() => setConfirm(false)}
        onConfirm={() => void remove()}
        text={
          <>
            <p>
              Курс <b>«{title}»</b> вместе со всеми модулями и занятиями будет удалён из Sanity без возможности восстановления.
            </p>
            <p>Ученики потеряют доступ к материалам курса. Записи об оплатах в базе сохранятся.</p>
          </>
        }
      />
    </>
  );
}
