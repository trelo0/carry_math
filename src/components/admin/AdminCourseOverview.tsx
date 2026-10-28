'use client';

import AdminCourseDocForm from '@/components/admin/AdminCourseDocForm';
import { CoverUpload } from '@/components/admin/AdminFileInputs';
import type { FormField, SanityDocValues } from '@/lib/admin/sanity-form-types';

type Props = {
  sanityId: string;
  slug: string;
  fields: FormField[];
  doc: SanityDocValues | null;
  writeEnabled: boolean;
};

export default function AdminCourseOverview({ sanityId, slug, fields, doc, writeEnabled }: Props) {
  return (
    <AdminCourseDocForm
      key={sanityId}
      scope="overview"
      fields={fields}
      doc={doc}
      id={sanityId}
      writeEnabled={writeEnabled}
      refreshOnSave
      className="admin-ov"
      renderField={(f, ctx) => {
        if (f.name === 'coverImage') {
          return (
            <CoverUpload
              title={f.title}
              value={ctx.values.coverImage}
              disabled={ctx.disabled}
              onChange={(v) => ctx.setField('coverImage', v)}
            />
          );
        }
        if (f.name === 'description') {
          const text = ctx.values.description === undefined || ctx.values.description === null ? '' : String(ctx.values.description);
          const rows = Math.max(6, text.split('\n').length + 1);
          return (
            <div className="admin-sf__field">
              <span className="admin-sf__label">{f.title}</span>
              <textarea
                className="admin-sf__input admin-sf__textarea admin-ov__desc"
                rows={rows}
                value={text}
                disabled={ctx.disabled}
                onChange={(e) => ctx.setField('description', e.target.value)}
              />
            </div>
          );
        }
        return null;
      }}
      layout={({ nodes, bar }) => (
        <>
          <section className="admin-form__card admin-ov__hero">
            <div className="admin-ov__cover">{nodes.coverImage}</div>
            <div className="admin-ov__main">
              <h3 className="admin-form__card-title">Обзор курса</h3>
              {nodes.title}
              {nodes.cabinetEyebrow}
              <div className="admin-ov__pair">
                {nodes.deliveryFormat}
                <div className="admin-sf__field">
                  <span className="admin-sf__label">Код курса (slug)</span>
                  <input className="admin-sf__input" value={slug} readOnly disabled />
                </div>
              </div>
            </div>
          </section>
          <section className="admin-form__card admin-ov__section">
            <h3 className="admin-form__card-title">Описание</h3>
            {nodes.description}
          </section>
          <section className="admin-form__card admin-ov__section">
            <h3 className="admin-form__card-title">Что внутри курса</h3>
            {nodes.cabinetPreviewInside}
          </section>
          <div className="admin-cform__savebar">{bar}</div>
        </>
      )}
    />
  );
}
