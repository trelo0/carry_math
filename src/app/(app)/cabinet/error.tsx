'use client';

import Link from 'next/link';

export default function CabinetError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message =
    error.message?.trim() ||
    'Не удалось загрузить кабинет. Проверьте интернет и попробуйте снова.';

  return (
    <div className="cab-err-page">
      <div className="cab-panel cab-err-card">
        <h1>Кабинет временно недоступен</h1>
        <p>{message}</p>
        <div className="cab-err-actions">
          <button type="button" className="cab-btn cab-btn--join" onClick={() => reset()}>
            Повторить
          </button>
          <Link className="cab-btn cab-btn--line" href="/">
            На главную
          </Link>
        </div>
      </div>
    </div>
  );
}
