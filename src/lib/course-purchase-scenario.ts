export type PurchaseScenario = 'start_from_beginning' | 'join_current';

export function purchaseScenarioLabel(scenario: PurchaseScenario | null | undefined): string | null {
  if (scenario === 'start_from_beginning') return 'С начала курса';
  if (scenario === 'join_current') return 'С текущего модуля';
  return null;
}

export function sumActiveCoursePackages(
  packages: { product: string; remaining: number; total: number; active: boolean }[],
): { remaining: number; total: number; hasActiveRemaining: boolean } {
  const courseRows = packages.filter((p) => p.product === 'course' && p.active);
  return {
    remaining: courseRows.reduce((sum, p) => sum + p.remaining, 0),
    total: courseRows.reduce((sum, p) => sum + p.total, 0),
    hasActiveRemaining: courseRows.some((p) => p.remaining > 0),
  };
}
