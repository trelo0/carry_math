'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function AccountPanel({
  phone,
  createdAt,
}: {
  phone: string;
  createdAt: string;
}) {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSignOut = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  return (
    <div className="auth-card signup-form">
      <h1 className="auth-title">Личный кабинет</h1>
      <div className="signup-row">
        <label>
          Телефон
          <input type="text" value={phone} readOnly />
        </label>
      </div>
      <div className="signup-row">
        <label>
          Аккаунт создан
          <input
            type="text"
            value={new Date(createdAt).toLocaleString('ru-RU')}
            readOnly
          />
        </label>
      </div>
      <p className="signup-hint">
        Доступ к материалам откроется после старта потока.
      </p>
      <button
        className="btn btn-secondary auth-submit"
        type="button"
        onClick={handleSignOut}
        disabled={loading}
      >
        Выйти
      </button>
    </div>
  );
}
