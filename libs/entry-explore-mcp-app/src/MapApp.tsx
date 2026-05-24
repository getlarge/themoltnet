import { useApp } from '@modelcontextprotocol/ext-apps/react';
import type { EntryCardEntry } from '@moltnet/diary-ui';
import { MoltThemeProvider } from '@themoltnet/design-system';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import { McpDiaryAdapter, parseToolJson } from './adapter/mcp-adapter.js';
import { Breadcrumb } from './components/Breadcrumb.js';
import { NextSteps, type Pivot } from './components/NextSteps.js';
import { Overview } from './components/Overview.js';
import { ZoneView } from './components/ZoneView.js';
import { ENTRY_EXPLORE_MCP_APP_TITLE } from './metadata.js';
import { findZone, type MapAction, mapReducer } from './state/map.js';
import { parseOpenPayload } from './state/parse-open.js';
import { applyThemeTokens } from './theme-tokens.js';

applyThemeTokens();

/** Suggested pivots for the current zone: jump to a sibling zone. */
function pivotsForZone(
  zones: { id: string; label: string }[],
  activeZoneId: string | null,
): Pivot[] {
  return zones
    .filter((zone) => zone.id !== activeZoneId)
    .slice(0, 4) // V1: intentionally cap at 4 pivots to keep the row compact
    .map((zone) => ({ id: zone.id, label: `→ ${zone.label}` }));
}

export function MapApp() {
  // A ref bridges the ext-apps handlers (registered in onAppCreated, BEFORE
  // connect, so the initial tool-input/result notification is never missed) to
  // the reducer dispatch, which doesn't exist yet at App-creation time. The
  // effect below keeps the ref current; dispatch from useReducer is stable.
  const seedRef = useRef<(init: ReturnType<typeof parseOpenPayload>) => void>(
    () => {},
  );

  const { app, isConnected, error } = useApp({
    appInfo: { name: ENTRY_EXPLORE_MCP_APP_TITLE, version: '0.1.0' },
    capabilities: {},
    autoResize: true,
    onAppCreated: (created) => {
      created.ontoolinput = (params) => {
        seedRef.current(
          parseOpenPayload((params as { arguments?: unknown }).arguments),
        );
      };
      created.ontoolresult = (result) => {
        seedRef.current(parseOpenPayload(parseToolJson(result)));
      };
    },
  });

  const [map, dispatch] = useReducer(mapReducer, null);
  const [entries, setEntries] = useState<EntryCardEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const adapter = useMemo(() => (app ? new McpDiaryAdapter(app) : null), [app]);

  // The agent seeds the map via the opener tool result (ontoolresult — a raw
  // CallToolResult envelope to unwrap) or a later push (ontoolinput — already
  // the raw arguments object). Either way it lands here via the ref.
  useEffect(() => {
    seedRef.current = (init) => {
      if (init) dispatch({ type: 'INIT', payload: init });
    };
  }, []);

  const activeZone = map ? findZone(map, map.activeZoneId) : null;

  // Resolve the focused zone's entries by id via the host bridge.
  const diaryId = map?.diaryId ?? null;
  const zoneEntryKey = activeZone ? activeZone.entryIds.join(',') : null;
  useEffect(() => {
    if (!adapter || !diaryId || !zoneEntryKey) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoadingEntries(true);
    adapter
      .listEntries({ diaryId, ids: zoneEntryKey.split(',').slice(0, 50) })
      .then((list) => {
        if (cancelled) return;
        setEntries(list.items as unknown as EntryCardEntry[]);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingEntries(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, diaryId, zoneEntryKey]);

  const onSaveZone = useCallback(
    async (zone: typeof activeZone) => {
      if (!adapter || !map || !zone) return;
      setSaving(true);
      setSaveError(null);
      try {
        if (!zone.packId) {
          const draft = await adapter.createZonePack({
            diaryId: map.diaryId,
            label: zone.label,
            entryIds: zone.entryIds,
            provenance: zone.provenance,
          });
          // createZonePack resolves the UUID from the CID; if that came back
          // empty, pinning later would no-op — surface it rather than silently
          // marking the zone saved.
          if (!draft.packId) {
            throw new Error('Could not resolve the saved pack id.');
          }
          dispatch({
            type: 'MATERIALIZE_ZONE',
            zoneId: zone.id,
            packId: draft.packId,
          });
        } else if (!zone.pinned) {
          await adapter.setZonePinned(zone.packId, true);
          dispatch({ type: 'PIN_ZONE', zoneId: zone.id, pinned: true });
        }
      } catch (err) {
        // Don't let the save fail silently (the button would just reset to
        // "Save this zone" and re-clicking would retry blindly). Show why.
        setSaveError(err instanceof Error ? err.message : 'Save failed.');
      } finally {
        setSaving(false);
      }
    },
    [adapter, map],
  );

  if (error) {
    return (
      <Shell>
        <Status state={`Error: ${error.message}`} live={false} />
        <div className="fallback">{error.message}</div>
      </Shell>
    );
  }

  if (!map) {
    return (
      <Shell>
        <Status
          state={isConnected ? 'Connected' : 'Connecting to host…'}
          live={isConnected}
        />
        <div className="fallback">
          Waiting for the agent to interpret your diary. Ask it to open the
          diary map — it will sample entries and propose knowledge zones.
        </div>
      </Shell>
    );
  }

  const pivots = pivotsForZone(map.zones, map.activeZoneId);

  return (
    <Shell>
      <Status state="Connected" live={isConnected} />
      <Breadcrumb
        trail={map.trail}
        activeStep={map.activeStep}
        onRestore={(index) => dispatch({ type: 'RESTORE_STEP', index })}
      />

      {activeZone ? (
        <ZoneView
          zone={activeZone}
          entries={entries}
          loading={loadingEntries}
          onBack={() => dispatch({ type: 'SHOW_OVERVIEW' })}
          onOpenEntry={(entryId) => {
            // Entry-level deep-dive is a follow-up; for now, log intent so the
            // host transcript records which entry the human wanted to open.
            void app?.callServerTool({
              name: 'entries_get',
              arguments: { entry_id: entryId },
            });
          }}
          onTagClick={() => {
            /* tag-driven pivot handled by the agent in a later iteration */
          }}
        />
      ) : (
        <Overview
          map={map}
          onFocusZone={(zoneId: string) =>
            dispatch({ type: 'FOCUS_ZONE', zoneId } as MapAction)
          }
        />
      )}

      <NextSteps
        pivots={pivots}
        onPivot={(pivot) => dispatch({ type: 'FOCUS_ZONE', zoneId: pivot.id })}
        zone={activeZone}
        onSaveZone={(zone) => void onSaveZone(zone)}
        saving={saving}
        saveError={saveError}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <MoltThemeProvider mode="dark">
      <div className="app-root">{children}</div>
    </MoltThemeProvider>
  );
}

function Status({ state, live }: { state: string; live: boolean }) {
  return (
    <div className="status-line">
      <span className={`status-dot${live ? ' live' : ''}`} aria-hidden="true" />
      {state}
    </div>
  );
}
