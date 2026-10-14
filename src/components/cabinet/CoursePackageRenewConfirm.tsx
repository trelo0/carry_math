'use client';

type CoursePackageRenewConfirmProps = {
  remaining: number;
  total: number;
  grantLessons: number;
  onConfirm: () => void;
  onClose: () => void;
};

export default function CoursePackageRenewConfirm({
  remaining,
  total,
  grantLessons,
  onConfirm,
  onClose,
}: CoursePackageRenewConfirmProps) {
  return (
    <div className="pscenario-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="pscenario-dialog pscenario-dialog--compact" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="pscenario-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <h2 className="pscenario-title">Продлить пакет занятий?</h2>
        <p className="pscenario-subtitle">
          У вас уже есть оплаченный пакет курса: осталось <strong>{remaining}</strong> из{' '}
          <strong>{total}</strong> занятий. После оплаты начислим ещё{' '}
          <strong>{grantLessons}</strong> — они добавятся к текущему остатку.
        </p>
        <div className="pscenario-actions">
          <button type="button" className="pscenario-button primary" onClick={onConfirm}>
            Да, продлить пакет
          </button>
          <button type="button" className="pscenario-button secondary" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
