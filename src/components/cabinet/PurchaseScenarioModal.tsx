'use client';

import { useState } from 'react';
import ConsentCheckbox from '@/components/forms/ConsentCheckbox';
import type { PurchaseScenario } from '@/lib/course-purchase-scenario';
import type { PurchaseScenarios } from '@/lib/studio/courseContent';

interface PurchaseScenarioModalProps {
  scenarios: PurchaseScenarios | null;
  priceByn: number;
  courseSlug: string;
  onClose: () => void;
  mode?: 'first' | 'extend' | 'direct';
  grantedLessons?: number;
  savedScenarioLabel?: string | null;
}

function initialSelectedScenario(scenarios: PurchaseScenarios | null): PurchaseScenario | null {
  if (!scenarios) return null;
  const hasStart = Boolean(scenarios.startFromBeginning);
  const hasJoin = Boolean(scenarios.joinCurrent);
  if (hasStart && !hasJoin) return 'start_from_beginning';
  if (hasJoin && !hasStart) return 'join_current';
  return null;
}

export default function PurchaseScenarioModal({
  scenarios,
  priceByn,
  courseSlug,
  onClose,
  mode = 'first',
  grantedLessons = 8,
  savedScenarioLabel = null,
}: PurchaseScenarioModalProps) {
  const [selectedScenario, setSelectedScenario] = useState<PurchaseScenario | null>(() =>
    initialSelectedScenario(scenarios),
  );
  const [consent, setConsent] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isExtend = mode === 'extend';
  const isDirect = mode === 'direct';
  if (!isExtend && !isDirect && !scenarios) return null;

  const showStart = Boolean(scenarios?.startFromBeginning);
  const showJoin = Boolean(scenarios?.joinCurrent);
  const twoCards = showStart && showJoin;

  const handlePayClick = async () => {
    const scenarioToSend = isExtend || isDirect ? undefined : selectedScenario;
    if (!isExtend && !isDirect && !selectedScenario) return;
    if (!consent) return;

    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch('/api/payments/create-token', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          courseSlug,
          ...(scenarioToSend ? { scenario: scenarioToSend } : {}),
        }),
      });

      const raw = await response.text();
      let data: { error?: string; redirect_url?: string } | null = null;
      try {
        data = raw ? (JSON.parse(raw) as { error?: string; redirect_url?: string }) : null;
      } catch {
        setError('Сервер вернул некорректный ответ. Смотрите лог терминала `next dev`.');
        return;
      }

      if (!response.ok) {
        setError(data?.error || 'Ошибка создания платежа');
        return;
      }

      if (data?.redirect_url) {
        window.location.href = data.redirect_url;
      } else {
        setError('Не получен URL для оплаты');
      }
    } catch (err) {
      console.error('[create payment token]', err);
      setError('Не удалось связаться с сервером сайта. Проверьте, что dev-сервер запущен.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleScenarioSelect = (scenario: PurchaseScenario) => {
    setSelectedScenario(scenario);
    setError(null);
  };

  const payButtonLabel = (): string => {
    if (isProcessing) return 'Создание платежа...';
    if (isExtend || isDirect) return `Оплатить · ${grantedLessons} занятий`;
    if (selectedScenario === 'start_from_beginning' && scenarios?.startFromBeginning) {
      return scenarios.startFromBeginning.buttonLabel;
    }
    if (selectedScenario === 'join_current' && scenarios?.joinCurrent) {
      return scenarios.joinCurrent.buttonLabel;
    }
    return twoCards ? 'Выберите формат обучения' : 'Подтвердить и оплатить';
  };

  return (
    <div
      className="pscenario-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pscenario-title"
      onClick={onClose}
    >
      <div className="pscenario-dialog" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="pscenario-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>

        <h2 id="pscenario-title" className="pscenario-title">
          {isExtend ? 'Купить пакет занятий' : isDirect ? 'Оплата курса' : 'Выберите формат обучения'}
        </h2>
        <p className="pscenario-subtitle">
          {isExtend
            ? `Пакет из ${grantedLessons} занятий по вашему сохранённому формату обучения${
                savedScenarioLabel ? `: ${savedScenarioLabel}` : ''
              }.`
            : isDirect
              ? `Пакет из ${grantedLessons} занятий. Оплата на защищённой странице bePaid.`
              : twoCards
                ? 'Два варианта прохождения курса. Выберите подходящий для вас.'
                : 'Подтвердите формат обучения перед оплатой.'}
        </p>

        {!isExtend && !isDirect && scenarios ? (
          <div className="scenario-cards">
            {showStart && scenarios.startFromBeginning ? (
              <div
                className={`scenario-card ${selectedScenario === 'start_from_beginning' ? 'selected' : ''}`}
                onClick={() => handleScenarioSelect('start_from_beginning')}
              >
                <h3 className="scenario-card-title">{scenarios.startFromBeginning.title}</h3>
                <p className="scenario-card-description">{scenarios.startFromBeginning.description}</p>
                {scenarios.startFromBeginning.benefits.length > 0 && (
                  <ul className="scenario-card-benefits">
                    {scenarios.startFromBeginning.benefits.map((benefit, index) => (
                      <li key={index}>{benefit}</li>
                    ))}
                  </ul>
                )}
                {scenarios.startFromBeginning.subtitle && (
                  <p className="scenario-card-subtitle">{scenarios.startFromBeginning.subtitle}</p>
                )}
              </div>
            ) : null}

            {showJoin && scenarios.joinCurrent ? (
              <div
                className={`scenario-card ${selectedScenario === 'join_current' ? 'selected' : ''}`}
                onClick={() => handleScenarioSelect('join_current')}
              >
                <h3 className="scenario-card-title">{scenarios.joinCurrent.title}</h3>
                <p className="scenario-card-description">{scenarios.joinCurrent.description}</p>
                {scenarios.joinCurrent.benefits.length > 0 && (
                  <ul className="scenario-card-benefits">
                    {scenarios.joinCurrent.benefits.map((benefit, index) => (
                      <li key={index}>{benefit}</li>
                    ))}
                  </ul>
                )}
                {scenarios.joinCurrent.subtitle && (
                  <p className="scenario-card-subtitle">{scenarios.joinCurrent.subtitle}</p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="pscenario-price">
          <strong>{priceByn} BYN</strong>
          <span>
            {isDirect || isExtend
              ? 'к оплате'
              : twoCards
                ? 'одинаковая цена для обоих форматов'
                : 'к оплате'}
          </span>
        </div>

        <div className="pscenario-consent">
          <ConsentCheckbox id="purchase-scenario-consent" checked={consent} onChange={setConsent} />
        </div>

        {error && <div className="pscenario-error">{error}</div>}

        <div className="pscenario-actions">
          {(isExtend || isDirect || selectedScenario) && consent ? (
            <button
              type="button"
              className="pscenario-button primary"
              onClick={handlePayClick}
              disabled={isProcessing}
            >
              {payButtonLabel()}
            </button>
          ) : (
            <button type="button" className="pscenario-button primary" disabled>
              {!isExtend && !isDirect && !selectedScenario
                ? 'Выберите формат обучения'
                : 'Примите политику конфиденциальности'}
            </button>
          )}
          <button type="button" className="pscenario-button secondary" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
