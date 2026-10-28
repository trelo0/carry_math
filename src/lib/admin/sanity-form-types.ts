/** Описание полей Sanity-схем для универсальной формы (генерируется scripts/gen-sanity-forms.ts). */

export type FormOption = { title: string; value: string };

export type FormField = {
  name: string;
  title: string;
  /** string | text | number | boolean | url | date | datetime | image | array | object | reference | slug */
  type: string;
  description?: string;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  readOnly?: boolean;
  list?: FormOption[];
  initialValue?: unknown;
  /** type=object */
  fields?: FormField[];
  /** type=array */
  of?: FormMember[];
};

export type FormMember = {
  type: string;
  /** Имя типа элемента (_type в документе), если задано в схеме. */
  typeName?: string;
  title?: string;
  fields?: FormField[];
  /** Поле, значение которого показываем в заголовке элемента массива. */
  previewField?: string;
};

export type FormDoc = {
  name: string;
  title: string;
  description?: string;
  fields: FormField[];
};

export type SanityDocValues = Record<string, unknown> & {
  _id?: string;
  _type?: string;
  _rev?: string;
};
