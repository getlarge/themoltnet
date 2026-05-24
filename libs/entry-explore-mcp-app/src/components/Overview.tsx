import type { DiaryMap, Zone } from '../state/map.js';

export interface OverviewProps {
  map: DiaryMap;
  onFocusZone: (zoneId: string) => void;
}

/**
 * First paint: the agent's interpreted orientation plus one card per zone. The
 * card answers "what is in my diary" at a glance — label, why, a proportional
 * size bar, and a pin marker once validated. This is the antidote to the
 * prototype's raw-tag wall.
 */
export function Overview({ map, onFocusZone }: OverviewProps) {
  const maxSize = Math.max(1, ...map.zones.map((zone) => zone.entryIds.length));

  return (
    <div className="view-header" style={{ gap: 16 }}>
      <div className="view-header">
        <h2 className="view-title">{map.diaryName ?? 'Your diary'}</h2>
        {map.overview ? <p className="view-why">{map.overview}</p> : null}
        <span className="view-count">
          {map.zones.length} zones · sampled {map.sampledEntries} of{' '}
          {map.totalEntries} entries
        </span>
      </div>

      {map.zones.length === 0 ? (
        <div className="fallback">
          No zones yet. Ask the agent to interpret this diary — it will sample
          entries and propose a few knowledge zones to explore.
        </div>
      ) : (
        <div className="zone-grid">
          {map.zones.map((zone) => (
            <ZoneCard
              key={zone.id}
              zone={zone}
              maxSize={maxSize}
              onOpen={() => onFocusZone(zone.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ZoneCard({
  zone,
  maxSize,
  onOpen,
}: {
  zone: Zone;
  maxSize: number;
  onOpen: () => void;
}) {
  const pct = Math.round((zone.entryIds.length / maxSize) * 100);
  return (
    <button
      type="button"
      className={`zone-card${zone.pinned ? ' pinned' : ''}`}
      onClick={onOpen}
    >
      <div className="zone-card-head">
        <h3 className="zone-label">{zone.label}</h3>
        <span className="zone-size">
          {zone.pinned ? '★ ' : ''}
          {zone.entryIds.length}
        </span>
      </div>
      {zone.why ? <p className="zone-why">{zone.why}</p> : null}
      <div className="zone-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      {zone.territory ? (
        <span className="zone-tag">{zone.territory}</span>
      ) : null}
    </button>
  );
}
