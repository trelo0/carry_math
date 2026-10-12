'use client';

import { useState } from 'react';
import ConsentCheckbox from '@/components/forms/ConsentCheckbox';

type Scenario = 'start_from_beginning' | 'join_current';

type ScenarioCard = {
  title: string;
  description: string;
  benefits: string[];
  buttonLabel: string;
  subtitle?: string;
};

type PurchaseScenarios = {
  startFromBeginning: ScenarioCard;
  joinCurrent: ScenarioCard;
};

interface PurchaseScenarioModalProps {
  scenarios: PurchaseScenarios | null;
  priceByn: number;
  courseSlug: string;
  onClose: () => void;
}

export default function PurchaseScenarioModal({
  scenarios,
  priceByn,
  courseSlug,
  onClose,
}: PurchaseScenarioModalProps) {
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [consent, setConsent] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!scenarios) return null;

  const handlePayClick = async () => {
    if (!selectedScenario || !consent) return;

    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch('/api/payments/create-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          courseSlug,
          scenario: selectedScenario,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Ошибка создания платежа');
        return;
      }

      // Редирект на страницу оплаты bePaid
      if (data.redirect_url) {
        window.location.href = data.redirect_url;
      } else {
        setError('Не получен URL для оплаты');
      }
    } catch (err) {
      console.error('[create payment token]', err);
      setError('Ошибка соединения с платёжным шлюзом');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleScenarioSelect = (scenario: Scenario) => {
    setSelectedScenario(scenario);
    setError(null);
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
          Выберите формат обучения
        </h2>
        <p className="pscenario-subtitle">
          Два варианта прохождения курса. Выберите подходящий для вас.
        </p>

        <div className="scenario-cards">
          {/* Card 1: Start from beginning */}
          <div
            className={`scenario-card ${selectedScenario === 'start_from_beginning' ? 'selected' : ''}`}
            onClick={() => handleScenarioSelect('start_from_beginning')}
          >
            <h3 className="scenario-card-title">{scenarios.startFromBeginning.title}</h3>
            <p className="scenario-card-description">
              {scenarios.startFromBeginning.description}
            </p>
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

          {/* Card 2: Join current */}
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
        </div>

        <div className="pscenario-price">
          <strong>{priceByn} BYN</strong>
          <span>одинаковая цена для обоих форматов</span>
        </div>

        <div className="pscenario-consent">
          <ConsentCheckbox id="purchase-scenario-consent" checked={consent} onChange={setConsent} />
        </div>

        {error && (
          <div className="pscenario-error">
            {error}
          </div>
        )}

        <div className="pscenario-actions">
          {selectedScenario && consent ? (
            <button
              type="button"
              className="pscenario-button primary"
              onClick={handlePayClick}
              disabled={isProcessing}
            >
              {isProcessing ? 'Создание платежа...' : (
                selectedScenario === 'start_from_beginning'
                  ? scenarios.startFromBeginning.buttonLabel
                  : scenarios.joinCurrent.buttonLabel
              )}
            </button>
          ) : (
            <button type="button" className="pscenario-button primary" disabled>
              {!selectedScenario ? 'Выберите формат обучения' : 'Примите политику конфиденциальности'}
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
