'use client';

import AdminCourseDocForm, { type FieldRenderCtx } from '@/components/admin/AdminCourseDocForm';
import { FieldEditor, type Values } from '@/components/admin/AdminSanityEditor';
import type { FormField, SanityDocValues } from '@/lib/admin/sanity-form-types';

type Props = {
  sanityId: string;
  fields: FormField[];
  doc: SanityDocValues | null;
  writeEnabled: boolean;
};

const SHOW_START = ['both', 'start_from_beginning'];
const SHOW_JOIN = ['both', 'join_current'];

function renderScenarios(field: FormField, ctx: FieldRenderCtx): React.ReactNode | null {
  if (field.name !== 'purchaseScenarios') return null;
  const value = (ctx.values.purchaseScenarios as Values | undefined) ?? {};
  const mode = typeof value.mode === 'string' ? value.mode : 'none';
  const set = (name: string, v: unknown) => {
    const next = { ...value };
    if (v === undefined) delete next[name];
    else next[name] = v;
    ctx.setField('purchaseScenarios', Object.keys(next).length ? next : undefined);
  };
  const sub = (name: string) => field.fields?.find((f) => f.name === name);
  const modeField = sub('mode');
  const start = sub('startFromBeginning');
  const join = sub('joinCurrent');

  return (
    <fieldset className="admin-sf__group">
      <legend>{field.title}</legend>
      {field.description ? <span className="admin-sf__desc">{field.description}</span> : null}
      {modeField ? (
        <FieldEditor field={modeField} value={value.mode} disabled={ctx.disabled} onChange={(v) => set('mode', v)} />
      ) : null}
      {start && SHOW_START.includes(mode) ? (
        <FieldEditor field={start} value={value.startFromBeginning} disabled={ctx.disabled} onChange={(v) => set('startFromBeginning', v)} />
      ) : null}
      {join && SHOW_JOIN.includes(mode) ? (
        <FieldEditor field={join} value={value.joinCurrent} disabled={ctx.disabled} onChange={(v) => set('joinCurrent', v)} />
      ) : null}
    </fieldset>
  );
}

export default function AdminCoursePricing({ sanityId, fields, doc, writeEnabled }: Props) {
  return (
    <AdminCourseDocForm
      key={sanityId}
      scope="pricing"
      fields={fields}
      doc={doc}
      id={sanityId}
      writeEnabled={writeEnabled}
      refreshOnSave
      renderField={renderScenarios}
      layout={({ nodes, bar }) => (
        <>
          <section className="admin-form__card admin-ov__section">
            <h3 className="admin-form__card-title">Цены</h3>
            {nodes.pricing}
          </section>
          <section className="admin-form__card admin-ov__section">
            <h3 className="admin-form__card-title">Сценарии покупки</h3>
            {nodes.purchaseScenarios}
          </section>
          <div className="admin-cform__savebar">{bar}</div>
        </>
      )}
    />
  );
}