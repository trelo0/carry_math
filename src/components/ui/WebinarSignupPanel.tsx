'use client';

import { WebinarSignupOptions } from './WebinarSignupOptions';

// Единое содержимое окна записи на бесплатный вебинар:
// используется и во всплывающем окне при входе (variant = 'entry'),
// и в окне по кнопке «Записаться на курс» (variant = 'course').
type WebinarPanelVariant = 'entry' | 'course';

const TITLES: Record<WebinarPanelVariant, { main: string; sub: string }> = {
  entry: { main: 'Бесплатный вебинар', sub: 'по математике' },
  course: { main: 'Записаться на курс', sub: 'District' },
};

export default function WebinarSignupPanel({
  variant,
  notice,
  onClose,
}: {
  variant: WebinarPanelVariant;
  notice?: string;
  onClose: () => void;
}) {
  const title = TITLES[variant];

  return (
    <div className="webinar-frame">
      <div className="webinar-frame-inner">
        <div className="webinar-panel-header">
          <span className="webinar-logo-badge" aria-hidden="true">
            <span className="logo-icon" />
          </span>

          <div className="webinar-heading">
            <h2 className="webinar-title-main">{title.main}</h2>
            {title.sub ? (
              <span className="webinar-title-sub">{title.sub}</span>
            ) : null}
            {variant === 'entry' ? (
              <span className="webinar-reg-status">Открыта регистрация</span>
            ) : null}
          </div>

          <button className="webinar-close" onClick={onClose} aria-label="Закрыть">
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="webinar-panel-body">
          {variant === 'entry' ? (
            <p className="webinar-popup-sub">
              Записывайся на бесплатный пробный вебинар — выбери удобный способ:
            </p>
          ) : (
            <>
              {notice ? <p className="modal-notice-note">{notice}</p> : null}
              <p className="webinar-popup-sub">
                Оставьте заявку через Telegram — мы свяжемся с вами для записи на курс.
              </p>
            </>
          )}

          <WebinarSignupOptions onChoose={onClose} purpose={variant === 'course' ? 'course' : 'webinar'} />

          {variant === 'entry' ? (
            <div className="webinar-chips">
              <span>Бесплатно</span>
              <i aria-hidden="true">•</i>
              <span>Онлайн</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
