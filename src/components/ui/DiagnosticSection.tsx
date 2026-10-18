import { INDIVIDUAL_DIAGNOSTIC_COPY } from '@/data/individualPageContent';

type DiagnosticStep = {
  title: string;
  text: string;
};
export default function DiagnosticSection({
  eyebrow,
  title,
  text,
  steps,
}: {
  eyebrow?: string;
  title?: string;
  text?: string;
  /** @deprecated CTA убран — поле оставлено для совместимости с CMS */
  buttonText?: string;
  steps?: DiagnosticStep[];
}) {
  const copy = INDIVIDUAL_DIAGNOSTIC_COPY;
  const items = steps && steps.length > 0 ? steps : copy.steps;

  return (
    <section className="section section-diagnostic" id="diagnostic">
      <div className="container">
        <div className="diagnostic-grid">
          <div className="diagnostic-panel">
            <div className="diagnostic-panel-deco" aria-hidden="true">
              <svg viewBox="0 0 520 360" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M420 300 520 240V120L420 180V300Z"
                  fill="#E8952C"
                  fillOpacity="0.55"
                />
                <path
                  d="M300 340 420 260V140L300 220V340Z"
                  fill="#F0A832"
                  fillOpacity="0.72"
                />
                <path
                  d="M180 360 300 280V160L180 240V360Z"
                  fill="#FFB533"
                  fillOpacity="0.88"
                />
                <path
                  d="M320 200 420 140V80L320 140V200Z"
                  fill="#C97818"
                  fillOpacity="0.45"
                />
                <path
                  d="M200 260 320 180V100L200 180V260Z"
                  fill="#E88820"
                  fillOpacity="0.58"
                />
              </svg>
            </div>
            <div className="diagnostic-panel-inner">
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
                {eyebrow?.trim() || copy.eyebrow}
              </span>
              <h2 className="diagnostic-title">
                {title?.trim() || copy.title}
              </h2>
              <p className="diagnostic-text">{text?.trim() || copy.text}</p>
            </div>
          </div>

          <div className="diagnostic-steps">
            {items.map((step, index) => (
              <div key={`${step.title}-${index}`} className="diagnostic-step">
                <span className="diagnostic-step-number">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="diagnostic-step-vrule" aria-hidden="true" />
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
