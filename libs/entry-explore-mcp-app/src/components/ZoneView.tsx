import { EntryCard, type EntryCardEntry } from '@moltnet/diary-ui';

import type { Zone } from '../state/map.js';

export interface ZoneViewProps {
  zone: Zone;
  /** Entries currently visible in this zone (resolved by the host fetch). */
  entries: EntryCardEntry[];
  loading: boolean;
  onBack: () => void;
  onOpenEntry: (entryId: string) => void;
  onTagClick: (tag: string) => void;
}

/**
 * A focused zone: a header that states plainly what you are looking at and why,
 * over a mosaic of the zone's entries. "Showing N entries" keeps the current
 * view legible (the prototype's first failure). Tag clicks bubble up so the
 * agent/human can pivot.
 */
export function ZoneView({
  zone,
  entries,
  loading,
  onBack,
  onOpenEntry,
  onTagClick,
}: ZoneViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button type="button" className="back-link" onClick={onBack}>
        ‹ Back to all zones
      </button>

      <div className="view-header">
        <h2 className="view-title">{zone.label}</h2>
        {zone.why ? <p className="view-why">{zone.why}</p> : null}
        <span className="view-count">
          {loading
            ? 'loading…'
            : `showing ${entries.length} of ${zone.entryIds.length} entries`}
          {zone.pinned ? ' · ★ validated' : ''}
        </span>
      </div>

      {entries.length === 0 && !loading ? (
        <div className="fallback">No entries resolved for this zone yet.</div>
      ) : (
        <div className="mosaic">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onOpen={onOpenEntry}
              onTagClick={onTagClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
