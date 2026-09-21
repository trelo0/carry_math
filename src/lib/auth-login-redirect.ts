/** Редirect на ту же страницу с флагом открытия модалки входа. */
export function authLoginRedirectPath(path: string): string {
  const safe = path.startsWith('/') && !path.startsWith('//') ? path : '/cabinet';
  const url = new URL(safe, 'http://local');
  url.searchParams.set('login', '1');
  return `${url.pathname}${url.search}`;
}

/** Убирает ?login=1 и ?next= после успешной серверной авторизации. */
export function pathWithoutAuthLoginQuery(
  pathname: string,
  params: Record<string, string | undefined>,
): string | null {
  if (params.login !== '1') return null;
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'login' || key === 'next' || value === undefined) continue;
    sp.set(key, value);
  }
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Legacy /login → главная с модалкой (и optional next). */
export function siteLoginRedirectPath(next?: string): string {
  const params = new URLSearchParams({ login: '1' });
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    params.set('next', next);
  }
  return `/?${params.toString()}`;
}
