import type { ActionFeedback, StaffRunAction, StaffRunActionOptions } from '@/lib/staff/run-action';

export const LESSON_MUTATION_OPTIONS: StaffRunActionOptions = {
  refresh: 'none',
  silent: true,
};

/** Сразу обновить UI и закрыть окно; запрос — в фоне, ошибка — в toast. */
export function runLessonMutationAsync(
  runAction: StaffRunAction,
  report: (feedback: ActionFeedback | null) => void,
  opts: {
    applyOptimistic: () => void;
    onClose?: () => void;
    successMessage: string;
    request: () => Promise<string | void>;
  },
) {
  opts.applyOptimistic();
  opts.onClose?.();
  report({ type: 'success', message: opts.successMessage });

  void runAction(opts.request, undefined, LESSON_MUTATION_OPTIONS).then((result) => {
    if (result?.type === 'error') report(result);
    else if (result?.type === 'success' && result.message) report(result);
  });
}
