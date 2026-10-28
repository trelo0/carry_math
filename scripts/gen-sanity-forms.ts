/**
 * Генерирует src/lib/admin/sanity-forms.json из Sanity-схем.
 * Запуск: npm run gen:sanity-forms (после изменения схем в sanity/math-cms/schemas).
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { COURSE_FORM_TYPES, SETTINGS_TABS } from '../src/lib/admin/settings-sections';
import type { FormDoc, FormField, FormMember } from '../src/lib/admin/sanity-form-types';

const root = path.resolve(__dirname, '..');
const shim = path.join(root, 'scripts', 'sanity-shim.ts');

// Подменяем 'sanity' и React-компоненты Studio заглушкой: схемы — обычные объекты.
type ResolveFn = (request: string, parent: unknown, ...rest: unknown[]) => string;
const M = Module as unknown as { _resolveFilename: ResolveFn };
const origResolve = M._resolveFilename;
M._resolveFilename = function (request, parent, ...rest) {
  if (request === 'sanity' || /(^|\/)components\//.test(request)) return shim;
  return origResolve.call(this, request, parent, ...rest);
};

const require = createRequire(import.meta.url ?? __filename);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;
const schemaTypes: Raw[] = require(path.join(root, 'sanity/math-cms/schemas/schemaTypes.ts')).default;
const byName = new Map<string, Raw>(schemaTypes.map((s) => [s.name, s]));

function isRequired(validation: unknown): boolean {
  if (typeof validation !== 'function') return false;
  let required = false;
  const rule: Raw = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'required') required = true;
      return () => rule;
    },
    apply: () => rule,
  });
  try {
    (validation as (r: unknown) => unknown)(rule);
  } catch {
    // ignore
  }
  return required;
}

function previewField(member: Raw): string | undefined {
  const sel = member?.preview?.select;
  if (sel && typeof sel.title === 'string') return sel.title;
  return undefined;
}

function convertMember(m: Raw): FormMember {
  const named = byName.get(m.type);
  if (named && named.type === 'object') {
    return {
      type: 'object',
      typeName: named.name,
      title: named.title,
      fields: convertFields(named.fields),
      previewField: previewField(named),
    };
  }
  if (m.type === 'object') {
    return {
      type: 'object',
      ...(m.name ? { typeName: m.name } : {}),
      title: m.title,
      fields: convertFields(m.fields ?? []),
      previewField: previewField(m),
    };
  }
  return { type: m.type, title: m.title };
}

function convertField(f: Raw): FormField | null {
  if (f.hidden === true) return null;
  const named = byName.get(f.type);
  let type: string = f.type;
  let fields: Raw[] | undefined = f.fields;
  if (named && named.type === 'object') {
    type = 'object';
    fields = named.fields;
  }
  const out: FormField = {
    name: f.name,
    title: f.title ?? f.name,
    type,
  };
  if (f.description) out.description = f.description;
  if (f.placeholder) out.placeholder = f.placeholder;
  if (f.rows) out.rows = f.rows;
  if (isRequired(f.validation)) out.required = true;
  if (f.readOnly === true) out.readOnly = true;
  if (f.initialValue !== undefined) out.initialValue = f.initialValue;
  const list = f.options?.list;
  if (Array.isArray(list)) {
    out.list = list.map((o: Raw) => (typeof o === 'string' ? { title: o, value: o } : { title: o.title, value: o.value }));
  }
  if (type === 'object' && fields) out.fields = convertFields(fields);
  if (type === 'array') out.of = (f.of ?? []).map(convertMember);
  return out;
}

function convertFields(fields: Raw[]): FormField[] {
  return fields.map(convertField).filter((f): f is FormField => f !== null);
}

const result: Record<string, FormDoc> = {};
for (const tab of SETTINGS_TABS) {
  for (const ref of tab.docs) {
    const schema = byName.get(ref.type);
    if (!schema) throw new Error(`Схема не найдена: ${ref.type}`);
    result[ref.type] = {
      name: schema.name,
      title: schema.title ?? schema.name,
      ...(schema.description ? { description: schema.description } : {}),
      fields: convertFields(schema.fields),
    };
  }
}

for (const type of COURSE_FORM_TYPES) {
  const schema = byName.get(type);
  if (!schema) throw new Error(`Схема не найдена: ${type}`);
  result[type] = {
    name: schema.name,
    title: schema.title ?? schema.name,
    fields: convertFields(schema.fields),
  };
}

const out = path.join(root, 'src/lib/admin/sanity-forms.json');
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`OK: ${Object.keys(result).length} документов → ${path.relative(root, out)}`);
