/** Подразделы «Настроек сайта» и документы Sanity, которые в них редактируются. */

export type SettingsTabId = 'general' | 'home' | 'individual' | 'cabinet' | 'notifications' | 'cabinets';

/** Просмотр кабинета с вкладки «Просмотр кабинетов» (query cabinetPreview). */
export type CabinetPreviewRole = 'student' | 'curator' | 'teacher';

export function parseCabinetPreview(raw?: string | null): CabinetPreviewRole | null {
  if (raw === 'student' || raw === 'curator' || raw === 'teacher') return raw;
  return null;
}

export type SettingsDocRef = {
  /** single — документ-одиночка с фиксированным _id; list — набор документов типа. */
  kind: 'single' | 'list';
  type: string;
  /** Для single — _id документа (как в sanity.config.ts). */
  id?: string;
  /** Показывать только эти поля (остальные при сохранении не трогаем). */
  onlyFields?: string[];
};

export type SettingsBlock = {
  title: string;
  docs: SettingsDocRef[];
};

export type SettingsTab = {
  id: SettingsTabId;
  label: string;
  docs: SettingsDocRef[];
  /** Визуальные группы на вкладке; если заданы — docs собирается из них. */
  blocks?: SettingsBlock[];
};

const single = (type: string, onlyFields?: string[]): SettingsDocRef => ({
  kind: 'single',
  type,
  id: type,
  ...(onlyFields ? { onlyFields } : {}),
});
const list = (type: string): SettingsDocRef => ({ kind: 'list', type });

export const SETTINGS_TABS: SettingsTab[] = [
  {
    id: 'general',
    label: 'Общие',
    docs: [],
    blocks: [
      {
        title: 'Брендинг и тексты сайта',
        docs: [
          single('siteSettings', [
            'title',
            'footerDescription',
            'instagramUrl',
            'headerButtonText',
            'heroButtonText',
            'teacherCardButtonText',
          ]),
        ],
      },
    ],
  },
  {
    id: 'home',
    label: 'Главная',
    docs: [],
    blocks: [
      { title: 'Hero курса', docs: [single('courseHero')] },
      { title: 'Блок наставника', docs: [single('mentorBlock')] },
      { title: 'Программа', docs: [single('programBlock')] },
      { title: 'Отзывы', docs: [single('reviewsBlock'), list('review')] },
      { title: 'Инициация', docs: [single('initBlock')] },
      { title: 'FAQ', docs: [single('faqBlock'), list('faqItem')] },
      { title: 'Развилка путей', docs: [single('pathsBlock')] },
    ],
  },
  {
    id: 'individual',
    label: 'Индивидуальные',
    docs: [],
    blocks: [
      { title: 'Hero страницы', docs: [single('individualHeroBlock')] },
      { title: 'Наставники', docs: [single('teachersBlock'), list('teacher')] },
      {
        title: 'Принципы и форматы',
        docs: [single('principlesBlock'), list('stat'), list('principle'), single('formatsBlock')],
      },
      {
        title: 'Процесс и выбор пути',
        docs: [single('processBlock'), list('processStep'), single('choosePathBlock')],
      },
      { title: 'Диагностика', docs: [single('diagnosticBlock')] },
    ],
  },
  {
    id: 'cabinet',
    label: 'Кабинет',
    docs: [],
    blocks: [
      {
        title: 'Боковая колонка ученика',
        docs: [single('cabinetAsideSettings', ['cabinetQuotes', 'examDate', 'examLabel'])],
      },
    ],
  },
  { id: 'notifications', label: 'Уведомления', docs: [] },
  { id: 'cabinets', label: 'Просмотр кабинетов', docs: [] },
];

export function settingsTabDocRefs(tab: SettingsTab): SettingsDocRef[] {
  if (tab.blocks?.length) return tab.blocks.flatMap((b) => b.docs);
  return tab.docs;
}

export function parseSettingsTab(raw?: string): SettingsTabId {
  return SETTINGS_TABS.some((t) => t.id === raw) ? (raw as SettingsTabId) : 'general';
}

export function findSettingsDoc(type: string): SettingsDocRef | null {
  for (const tab of SETTINGS_TABS) {
    const hit = settingsTabDocRefs(tab).find((d) => d.type === type);
    if (hit) return hit;
  }
  return null;
}

/** Типы курсов Sanity: описание полей для форм панели курса (не вкладки настроек). */
export const COURSE_FORM_TYPES = ['districtCourse', 'districtModule', 'districtCourseLesson'] as const;

/** Куда ведёт кнопка «Вернуться» в просматриваемых кабинетах. */
export const CABINETS_RETURN_HREF = '/cabinet/admin/settings?tab=cabinets';
