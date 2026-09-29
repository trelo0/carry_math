const AUTH_HASHES = new Set(['login', 'register']);

export function getAuthHash(): 'login' | 'register' | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.slice(1).toLowerCase();
  return AUTH_HASHES.has(hash) ? (hash as 'login' | 'register') : null;
}

export function clearAuthHash(): void {
  if (typeof window === 'undefined' || !getAuthHash()) return;
  const url = window.location.pathname + window.location.search;
  window.history.replaceState(null, '', url);
}
