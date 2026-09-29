export type StaffRefreshScope = 'full' | 'teacher' | 'none';

export type ActionFeedback = {
  type: 'success' | 'error';
  message: string;
};

export type StaffRunActionOptions = {
  refresh?: StaffRefreshScope;
  /** Ждать перезагрузку данных перед возвратом (по умолчанию — нет, обновление в фоне). */
  awaitRefresh?: boolean;
};

export type StaffRunAction = (
  action: () => Promise<string | void>,
  successText?: string,
  options?: StaffRunActionOptions,
) => Promise<ActionFeedback | null>;
