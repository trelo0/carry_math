const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ID события журнала: #EV-82F41 (из UUID записи). */
export function formatEventDisplayId(id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmed = id.replace(/-/g, '').toLowerCase();
  if (trimmed.length < 5) return null;
  return `#EV-${trimmed.slice(0, 5).toUpperCase()}`;
}

/** ID нарушения переписки: #MSG-4821. */
export function formatMsgDisplayId(id: number | null | undefined): string {
  if (id == null || !Number.isFinite(id)) return '#MSG-?';
  return `#MSG-${id}`;
}

/** ID проблемы админки: #PRB-12. */
export function formatProblemDisplayId(id: number | null | undefined): string {
  if (id == null || !Number.isFinite(id)) return '#PRB-?';
  return `#PRB-${id}`;
}

/** Короткий ID для UI (#2dc03f), полный UUID не показываем. */
export function formatShortDisplayId(id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (UUID_RE.test(trimmed)) return `#${trimmed.slice(0, 6).toLowerCase()}`;
  if (trimmed.length > 12) return `#${trimmed.slice(0, 6)}`;
  return `#${trimmed}`;
}
