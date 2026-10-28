'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import AdminCourseDocForm, { type FieldRenderCtx } from '@/components/admin/AdminCourseDocForm';
import { ChipsEditor, LessonFilesEditor, type FileMeta } from '@/components/admin/AdminFileInputs';
import { AdminDialog, ConfirmDialog, SwitchRow } from '@/components/admin/AdminUi';
import type { ProgramFile, ProgramLesson, ProgramModule } from '@/lib/admin/course-docs';
import type { FormField, SanityDocValues } from '@/lib/admin/sanity-form-types';

type Props = {
  courseSanityId: string;
  modules: ProgramModule[];
  moduleFields: FormField[];
  lessonFields: FormField[];
  writeEnabled: boolean;
};

type Panel =
  | { kind: 'new-module' }
  | { kind: 'new-lesson'; module: ProgramModule }
  | { kind: 'module'; id: string }
  | { kind: 'lesson'; id: string; moduleId: string }
  | null;

function compact(values: Record<string, unknown>): SanityDocValues {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) if (v !== '' && v !== undefined && v !== null) out[k] = v;
  return out as SanityDocValues;
}

function moduleDoc(m: ProgramModule): SanityDocValues {
  return compact({ _id: m.id, _rev: m.rev, title: m.title, color: m.color, sortOrder: m.sortOrder });
}

const fileItems = (list: ProgramFile[]) =>
  list.map((f) => ({
    _key: f.key,
    _type: 'lessonFile',
    published: f.published,
    file: { _type: 'file', asset: { _type: 'reference', _ref: f.ref } },
  }));

function lessonDoc(l: ProgramLesson): SanityDocValues {
  return compact({
    _id: l.id,
    _rev: l.rev,
    title: l.title,
    description: l.description,
    moduleOrder: l.moduleOrder,
    isTrialFree: l.isTrialFree,
    lessonDate: l.lessonDate,
    liveUrl: l.liveUrl,
    recordingUrl: l.recordingUrl,
    contentChips: l.chips.length ? l.chips : undefined,
    lessonMaterials: l.materials.length ? fileItems(l.materials) : undefined,
    lessonHomeworkFiles: l.homework.length ? fileItems(l.homework) : undefined,
  });
}

function fileMeta(l: ProgramLesson): FileMeta {
  const meta: FileMeta = {};
  for (const f of [...l.materials, ...l.homework]) meta[f.ref] = { name: f.name, size: f.size };
  return meta;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="admin-sect">
      <header className="admin-sect__head">
        <h4 className="admin-sect__title">{title}</h4>
        {hint ? <span className="admin-sect__hint">{hint}</span> : null}
      </header>
      <div className="admin-sect__body">{children}</div>
    </section>
  );
}

/** Кнопка «Удалить» + подтверждение. */
function DeleteAction({
  entity,
  id,
  label,
  title,
  text,
  disabled,
  onDeleted,
}: {
  entity: 'module' | 'lesson';
  id: string;
  label: string;
  title: string;
  text: React.ReactNode;
  disabled: boolean;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/courses/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, id }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Не удалось удалить');
        return;
      }
      setOpen(false);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="admin-sf__btn admin-sf__btn--danger-solid"
        disabled={disabled}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
          <path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {label}
      </button>
      <ConfirmDialog
        open={open}
        title={title}
        text={text}
        confirmLabel="Удалить навсегда"
        busy={busy}
        error={error}
        onClose={() => setOpen(false)}
        onConfirm={() => void run()}
      />
    </>
  );
}

const ORDER_HINT = 'Выставляется автоматически, можно изменить вручную.';

function withOrderHint(fields: FormField[]): FormField[] {
  return fields.map((f) =>
    f.name === 'moduleOrder' || f.name === 'sortOrder' ? { ...f, description: ORDER_HINT } : f,
  );
}

const trialSwitch = (ctx: FieldRenderCtx, field: FormField) =>
  field.name === 'isTrialFree' ? (
    <SwitchRow
      title="Пробное"
      hint="Доступно бесплатно"
      checked={ctx.values.isTrialFree === true}
      disabled={ctx.disabled}
      onChange={(v) => ctx.setField('isTrialFree', v)}
    />
  ) : null;

export default function AdminCourseProgram({ courseSanityId, modules, moduleFields, lessonFields, writeEnabled }: Props) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);

  const close = () => setPanel(null);
  const nextModuleNumber = modules.reduce((max, m) => Math.max(max, m.sortOrder), -1) + 2;

  const moduleFieldsUi = withOrderHint(moduleFields);
  const lessonFieldsUi = withOrderHint(lessonFields);
  const newModuleFields = moduleFieldsUi.filter((f) => ['title', 'color'].includes(f.name));
  const newLessonFields = lessonFieldsUi.filter((f) => ['title', 'description', 'isTrialFree'].includes(f.name));

  const activeModule = panel?.kind === 'module' ? modules.find((m) => m.id === panel.id) : undefined;
  const activeLesson =
    panel?.kind === 'lesson'
      ? modules.find((m) => m.id === panel.moduleId)?.lessons.find((l) => l.id === panel.id)
      : undefined;

  return (
    <div className="admin-prog">
      <div className="admin-prog__head">
        <div>
          <h3 className="admin-form__card-title">Программа курса</h3>
          <p className="admin-sf__desc">
            Модулей: {modules.length} · занятий: {modules.reduce((n, m) => n + m.lessons.length, 0)}
          </p>
        </div>
        <button type="button" className="admin-sf__btn admin-sf__btn--primary" onClick={() => setPanel({ kind: 'new-module' })}>
          + Добавить модуль
        </button>
      </div>

      {modules.length === 0 ? (
        <div className="admin-panel__card admin-panel__empty">
          <p className="admin-panel__empty-title">Программа пуста</p>
          <p className="admin-panel__empty-text">Добавьте первый модуль, затем занятия внутри него.</p>
        </div>
      ) : null}

      {modules.map((m) => (
        <section key={m.id} className="admin-prog__module">
          <button type="button" className="admin-prog__module-head" onClick={() => setPanel({ kind: 'module', id: m.id })}>
            <span className="admin-prog__dot" style={{ background: m.color }} />
            <span className="admin-prog__module-num">Модуль {m.sortOrder + 1}</span>
            <span className="admin-prog__module-title">{m.title || 'Без названия'}</span>
            <span className="admin-prog__count">{m.lessons.length} зан.</span>
            <span className="admin-prog__chev" aria-hidden>›</span>
          </button>
          <ul className="admin-prog__lessons">
            {m.lessons.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  className="admin-prog__lesson"
                  onClick={() => setPanel({ kind: 'lesson', id: l.id, moduleId: m.id })}
                >
                  <span className="admin-prog__lesson-num">{l.moduleOrder}</span>
                  <span className="admin-prog__lesson-title">{l.title || 'Без названия'}</span>
                  {l.isTrialFree ? <span className="admin-prog__badge">Пробное</span> : null}
                  <span className="admin-prog__chev" aria-hidden>›</span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="admin-prog__add"
                onClick={() => setPanel({ kind: 'new-lesson', module: m })}
              >
                + Добавить занятие
              </button>
            </li>
          </ul>
        </section>
      ))}

      {/* Новый модуль */}
      <AdminDialog open={panel?.kind === 'new-module'} onClose={close} title="Новый модуль" busy={busy}>
        <AdminCourseDocForm
          scope="module"
          fields={newModuleFields}
          doc={null}
          parentId={courseSanityId}
          isNew
          writeEnabled={writeEnabled}
          submitLabel="Создать модуль"
          onBusy={setBusy}
          onSaved={() => {
            close();
            router.refresh();
          }}
          layout={({ nodes, bar }) => (
            <>
              <div className="admin-dialog__lead">
                <span className="admin-dialog__lead-num">{nextModuleNumber}</span>
                <span>Номер модуля подставляется автоматически, изменить можно позже в настройках модуля.</span>
              </div>
              {nodes.title}
              {nodes.color}
              {bar}
            </>
          )}
        />
      </AdminDialog>

      {/* Новое занятие */}
      <AdminDialog
        open={panel?.kind === 'new-lesson'}
        onClose={close}
        title="Новое занятие"
        busy={busy}
      >
        {panel?.kind === 'new-lesson' ? (
          <AdminCourseDocForm
            scope="lesson"
            fields={newLessonFields}
            doc={null}
            parentId={panel.module.id}
            isNew
            writeEnabled={writeEnabled}
            submitLabel="Создать занятие"
            onBusy={setBusy}
            onSaved={() => {
              close();
              router.refresh();
            }}
            renderField={(f, ctx) => trialSwitch(ctx, f)}
            layout={({ nodes, bar }) => (
              <>
                <div className="admin-dialog__lead">
                  <span className="admin-dialog__lead-num">
                    {panel.module.lessons.reduce((max, l) => Math.max(max, l.moduleOrder), 0) + 1}
                  </span>
                  <span>
                    Занятие добавится в модуль «{panel.module.title}». Номер подставляется автоматически.
                  </span>
                </div>
                {nodes.title}
                {nodes.description}
                {nodes.isTrialFree}
                {bar}
              </>
            )}
          />
        ) : null}
      </AdminDialog>

      {/* Модуль */}
      <AdminDialog
        variant="drawer"
        open={Boolean(activeModule)}
        onClose={close}
        title={activeModule ? activeModule.title || 'Модуль' : 'Модуль'}
        busy={busy}
      >
        {activeModule ? (
          <AdminCourseDocForm
            key={activeModule.id}
            scope="module"
            fields={moduleFieldsUi}
            doc={moduleDoc(activeModule)}
            id={activeModule.id}
            writeEnabled={writeEnabled}
            onBusy={setBusy}
            onSaved={() => router.refresh()}
            barExtra={
              <DeleteAction
                entity="module"
                id={activeModule.id}
                label="Удалить модуль"
                title="Удалить модуль?"
                disabled={!writeEnabled || busy}
                text={
                  <>
                    <p>
                      Модуль <b>«{activeModule.title || 'Без названия'}»</b> будет полностью удалён из Sanity
                      {activeModule.lessons.length ? (
                        <>
                          {' '}
                          вместе с <b>{activeModule.lessons.length} занятиями</b> внутри
                        </>
                      ) : null}
                      .
                    </p>
                    <p>Действие необратимо.</p>
                  </>
                }
                onDeleted={() => {
                  close();
                  router.refresh();
                }}
              />
            }
            layout={({ nodes, bar }) => (
              <>
                <Section title="Основное">
                  {nodes.title}
                  {nodes.color}
                </Section>
                <Section title="Порядок" hint="Нумерация с нуля: 0 — первый модуль">
                  {nodes.sortOrder}
                </Section>
                {bar}
              </>
            )}
          />
        ) : null}
      </AdminDialog>

      {/* Занятие */}
      <AdminDialog
        variant="drawer"
        open={Boolean(activeLesson)}
        onClose={close}
        title={activeLesson ? activeLesson.title || 'Занятие' : 'Занятие'}
        busy={busy}
      >
        {activeLesson ? (
          <AdminCourseDocForm
            key={activeLesson.id}
            scope="lesson"
            fields={lessonFieldsUi}
            doc={lessonDoc(activeLesson)}
            id={activeLesson.id}
            writeEnabled={writeEnabled}
            onBusy={setBusy}
            onSaved={() => router.refresh()}
            renderField={(f, ctx) => {
              const trial = trialSwitch(ctx, f);
              if (trial) return trial;
              if (f.name === 'contentChips') {
                return (
                  <ChipsEditor
                    value={ctx.values.contentChips}
                    disabled={ctx.disabled}
                    onChange={(v) => ctx.setField('contentChips', v)}
                  />
                );
              }
              if (f.name === 'lessonMaterials' || f.name === 'lessonHomeworkFiles') {
                return (
                  <LessonFilesEditor
                    value={ctx.values[f.name]}
                    disabled={ctx.disabled}
                    meta={fileMeta(activeLesson)}
                    emptyText={f.name === 'lessonMaterials' ? 'Материалов пока нет' : 'Файлов ДЗ пока нет'}
                    onChange={(v) => ctx.setField(f.name, v)}
                  />
                );
              }
              return null;
            }}
            barExtra={
              <DeleteAction
                entity="lesson"
                id={activeLesson.id}
                label="Удалить занятие"
                title="Удалить занятие?"
                disabled={!writeEnabled || busy}
                text={
                  <>
                    <p>
                      Занятие <b>«{activeLesson.title || 'Без названия'}»</b> будет полностью удалено из Sanity.
                    </p>
                    <p>Действие необратимо.</p>
                  </>
                }
                onDeleted={() => {
                  close();
                  router.refresh();
                }}
              />
            }
            layout={({ nodes, bar }) => (
              <>
                <Section title="Основное">
                  {nodes.title}
                  {nodes.moduleOrder}
                  {nodes.description}
                  {nodes.isTrialFree}
                </Section>
                <Section title="Эфир и запись">
                  {nodes.lessonDate}
                  {nodes.liveUrl}
                  {nodes.recordingUrl}
                </Section>
                <Section title="Чипы" hint="До 4 пунктов в карточке занятия">
                  {nodes.contentChips}
                </Section>
                <Section title="Материалы к занятию" hint="Ученики видят файл, когда включён переключатель">
                  {nodes.lessonMaterials}
                </Section>
                <Section title="Домашнее задание" hint="Файлы ДЗ — тоже с переключателем видимости">
                  {nodes.lessonHomeworkFiles}
                </Section>
                {bar}
              </>
            )}
          />
        ) : null}
      </AdminDialog>
    </div>
  );
}
