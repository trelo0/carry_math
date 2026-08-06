type DiagnosticStep = {
  title: string;
  text: string;
};

const DEFAULT_STEPS: DiagnosticStep[] = [
  {
    title: 'Диагностика',
    text: '15 минут интерактивной симуляции определяют твои сильные стороны.',
  },
  {
    title: 'Выбор направления',
    text: 'Результат — персональная рекомендация. Финальное решение за тобой.',
  },
  {
    title: 'Старт подготовки',
    text: 'Работа с наставником, с которым реальный прогресс в подготовке.',
  },
];

export default function DiagnosticSection({
  eyebrow,
  title,
  text,
  buttonText,
  steps,
}: {
  eyebrow?: string;
  title?: string;
  text?: string;
  buttonText?: string;
  steps?: DiagnosticStep[];
}) {
  const items = steps && steps.length > 0 ? steps : DEFAULT_STEPS;

  return (
    <section className="section section-diagnostic" id="diagnostic">
      <div className="container">
        <div className="diagnostic-grid">
          <div className="diagnostic-panel">
            <span className="diagnostic-eyebrow">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <line x1="4" y1="8" x2="20" y2="8" />
                <circle cx="9" cy="8" r="2.5" fill="currentColor" stroke="none" />
                <line x1="4" y1="16" x2="20" y2="16" />
                <circle cx="15" cy="16" r="2.5" fill="currentColor" stroke="none" />
              </svg>
              {eyebrow?.trim() || 'Диагностика способностей'}
            </span>
            <h2 className="diagnostic-title">
              {title?.trim() || 'В чём твоя сильная сторона?'}
            </h2>
            <p className="diagnostic-text">
              {text?.trim() ||
                'Авторская диагностика подберёт направление под твой стиль мышления. Без подготовки и «правильных ответов» — только твои реальные способности.'}
            </p>
            {/* TODO: заменить заглушку на ссылку на страницу теста */}
            <button type="button" className="diagnostic-cta">
              {buttonText?.trim() || 'Пройти диагностику'}
              <span aria-hidden="true">→</span>
            </button>
          </div>

          <div className="diagnostic-steps">
            {items.map((step, index) => (
              <div key={step.title} className="diagnostic-step">
                <span className="diagnostic-step-number">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="diagnostic-step-content">
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
