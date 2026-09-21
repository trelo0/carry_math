'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';

// Событие шлём после успешного OTP-входа и после выхода,
// чтобы шапка и другие компоненты сразу обновили состояние.
export const AUTH_CHANGED_EVENT = 'auth:changed';

type AuthContextValue = {
  // Телефон авторизованного пользователя или null, если сессии нет.
  phone: string | null;
  loading: boolean;
  authOpen: boolean;
  /** Куда перейти после успешного OTP (по умолчанию /cabinet). */
  loginNext: string | null;
  openAuth: (next?: string) => void;
  closeAuth: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [loginNext, setLoginNext] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      const userPhone =
        (data.user?.user_metadata?.phone as string | undefined) ??
        data.user?.phone ??
        null;
      setPhone(userPhone);
      // После успешного входа модалка входа больше не нужна.
      if (userPhone) setAuthOpen(false);
    } catch {
      setPhone(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void refresh();
    });

    const onAuthChanged = () => void refresh();
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    };
  }, [refresh]);

  const openAuth = useCallback((next?: string) => {
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      setLoginNext(next);
    }
    setAuthOpen(true);
  }, []);
  const closeAuth = useCallback(() => {
    setAuthOpen(false);
    setLoginNext(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ phone, loading, authOpen, loginNext, openAuth, closeAuth }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth должен вызываться внутри AuthProvider');
  return ctx;
}
