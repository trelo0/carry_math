'use client';

import { useState } from 'react';
import Link from 'next/link';

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

  if (!scenarios) return null;

  const buildPayUrl = (scenario: Scenario): string => {
    const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
    if (!username) return 'mailto:district.school.210@gmail.com';
    return `https://t.me/${username}?start=pay_course_s_${courseSlug}:${scenario}`;
  };

  const handleScenarioSelect = (scenario: Scenario) => {
    setSelectedScenario(scenario);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          ×
        </button>

        <h2 className="modal-title">Выберите формат обучения</h2>
        <p className="modal-subtitle">
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

        <div className="modal-price">
          <strong>{priceByn} BYN</strong>
          <span>одинаковая цена для обоих форматов</span>
        </div>

        <div className="modal-actions">
          {selectedScenario ? (
            <a
              href={buildPayUrl(selectedScenario)}
              target="_blank"
              rel="noopener noreferrer"
              className="modal-button primary"
            >
              {selectedScenario === 'start_from_beginning'
                ? scenarios.startFromBeginning.buttonLabel
                : scenarios.joinCurrent.buttonLabel}
            </a>
          ) : (
            <button className="modal-button primary" disabled>
              Выберите формат обучения
            </button>
          )}
          <button className="modal-button secondary" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
