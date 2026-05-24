import type { TrailStep } from '../state/map.js';

export interface BreadcrumbProps {
  trail: TrailStep[];
  activeStep: number;
  /** Restore a past camera position (zero-fetch). */
  onRestore: (index: number) => void;
}

/**
 * The persistent path of camera moves — the primary "why did the set change"
 * device. Each chip shows its label and a truncated `why`; the current step is
 * highlighted in teal. Clicking any chip restores that exact view.
 */
export function Breadcrumb({ trail, activeStep, onRestore }: BreadcrumbProps) {
  return (
    <nav className="breadcrumb" aria-label="Exploration path">
      {trail.map((step, index) => (
        <span
          key={step.id}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {index > 0 && (
            <span className="crumb-sep" aria-hidden="true">
              ›
            </span>
          )}
          <button
            type="button"
            className={`crumb${index === activeStep ? ' current' : ''}`}
            aria-current={index === activeStep ? 'true' : undefined}
            title={step.why}
            onClick={() => onRestore(index)}
          >
            <span>{step.label}</span>
            {step.why && index === activeStep ? (
              <span className="crumb-why">{step.why}</span>
            ) : null}
          </button>
        </span>
      ))}
    </nav>
  );
}
