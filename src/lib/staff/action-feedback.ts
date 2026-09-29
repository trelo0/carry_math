import type { Dispatch, SetStateAction } from 'react';
import type { ActionFeedback, StaffRunAction, StaffRunActionOptions } from './run-action';

export async function runWithFeedback(
  runAction: StaffRunAction,
  setFeedback: Dispatch<SetStateAction<ActionFeedback | null>>,
  action: () => Promise<string | void>,
  successText?: string,
  options?: StaffRunActionOptions,
): Promise<ActionFeedback | null> {
  setFeedback(null);
  const result = await runAction(action, successText, options);
  if (result) setFeedback(result);
  return result;
}

export async function runWithKeyedFeedback(
  runAction: StaffRunAction,
  setFeedbacks: Dispatch<SetStateAction<Record<string, ActionFeedback>>>,
  key: string,
  action: () => Promise<string | void>,
  successText?: string,
  options?: StaffRunActionOptions,
): Promise<ActionFeedback | null> {
  setFeedbacks((prev) => {
    const next = { ...prev };
    delete next[key];
    return next;
  });
  const result = await runAction(action, successText, options);
  if (result) {
    setFeedbacks((prev) => ({ ...prev, [key]: result }));
  }
  return result;
}
