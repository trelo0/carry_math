/** Общие настройки auth-куки Supabase: сессия живёт 30 дней, пока пользователь сам не выйдет. */
export const supabaseCookieOptions = {
  path: '/',
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 30,
};
