import type { Zone } from '../state/map.js';

export interface Pivot {
  id: string;
  label: string;
}

export interface NextStepsProps {
  /** Suggested pivots for the current view (agent- or tag-derived). */
  pivots: Pivot[];
  onPivot: (pivot: Pivot) => void;
  /** The zone currently in focus, if any — enables "Save this zone". */
  zone: Zone | null;
  onSaveZone: (zone: Zone) => void;
  saving: boolean;
  /** Surfaced when the last save attempt failed, so it isn't a silent no-op. */
  saveError?: string | null;
}

/**
 * The explicit "what do I do next" affordance the prototype lacked. Shows
 * suggested pivots and, when a zone is focused, a "Save this zone" action that
 * materializes it as a draft pack (and, once saved, validates by pinning).
 */
export function NextSteps({
  pivots,
  onPivot,
  zone,
  onSaveZone,
  saving,
  saveError,
}: NextStepsProps) {
  const saved = Boolean(zone?.packId);
  return (
    <div className="next-steps">
      <h3>Where next</h3>
      <div className="pivot-row">
        {pivots.map((pivot) => (
          <button
            key={pivot.id}
            type="button"
            className="pivot"
            onClick={() => onPivot(pivot)}
          >
            {pivot.label}
          </button>
        ))}
        {zone ? (
          <button
            type="button"
            className={`pivot save${saved ? ' done' : ''}`}
            disabled={saving}
            onClick={() => onSaveZone(zone)}
          >
            {saved
              ? zone.pinned
                ? '★ Validated'
                : 'Saved — click to validate'
              : saving
                ? 'Saving…'
                : 'Save this zone'}
          </button>
        ) : null}
      </div>
      {saveError ? (
        <p className="next-steps-error" role="alert">
          {saveError}
        </p>
      ) : null}
    </div>
  );
}
