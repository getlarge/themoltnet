import {
  Badge,
  Card,
  MoltThemeProvider,
  Stack,
  Text,
} from '@themoltnet/design-system';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ExploreEntry, ExploreSurfaceState } from './types.js';

function entryTypeVariant(type: ExploreEntry['entryType']) {
  switch (type) {
    case 'procedural':
      return 'accent';
    case 'semantic':
      return 'primary';
    case 'episodic':
      return 'success';
    default:
      return 'default';
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function ExploreSurface({ state }: { state: ExploreSurfaceState }) {
  return (
    <MoltThemeProvider mode="dark">
      <div data-explore-root="true">
        <Stack gap={4}>
          <Card variant="surface" padding="md">
            <Stack gap={2}>
              <Text variant="h2">{state.diaryName}</Text>
              <Text color="muted">
                {state.estimatedEntryCount} total entries · {state.sampleCount}{' '}
                sampled · {state.visibleEntries.length} visible
              </Text>
              {state.orientationSummary && (
                <Text color="secondary">{state.orientationSummary}</Text>
              )}
              {(state.queryState.query ||
                state.queryState.includeTag ||
                state.queryState.entryType) && (
                <Text variant="caption" color="muted">
                  Focus:
                  {state.queryState.query
                    ? ` query "${state.queryState.query}"`
                    : ''}
                  {state.queryState.includeTag
                    ? ` tag ${state.queryState.includeTag}`
                    : ''}
                  {state.queryState.entryType
                    ? ` type ${state.queryState.entryType}`
                    : ''}
                </Text>
              )}
            </Stack>
          </Card>

          <div className="molt-explore-grid">
            <div className="molt-explore-main">
              <Card variant="surface" padding="md">
                <Stack gap={3}>
                  <Text variant="h4">
                    {state.suggestedDirections.length > 0
                      ? 'Suggested directions'
                      : 'Suggested pivots'}
                  </Text>
                  <div className="molt-chip-list">
                    {state.pivots.map((pivot) => (
                      <button
                        key={pivot.id}
                        className="molt-chip-button"
                        data-refine-kind={pivot.action.kind}
                        data-refine-value={pivot.action.value}
                        type="button"
                      >
                        <strong>{pivot.label}</strong>
                        <span>{pivot.description}</span>
                      </button>
                    ))}
                  </div>
                </Stack>
              </Card>

              <Card variant="surface" padding="md">
                <Stack gap={3}>
                  <Text variant="h4">Entry mosaic</Text>
                  {state.selectionBasis && (
                    <Text variant="caption" color="muted">
                      {state.selectionBasis.description}
                    </Text>
                  )}
                  <div className="molt-entry-mosaic">
                    {state.visibleEntries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className="molt-entry-tile"
                        data-entry-id={entry.id}
                      >
                        <Stack gap={2}>
                          <Stack
                            direction="row"
                            align="center"
                            justify="space-between"
                            gap={2}
                            wrap
                          >
                            <Badge variant={entryTypeVariant(entry.entryType)}>
                              {entry.entryType}
                            </Badge>
                            <Text variant="caption" color="muted">
                              {formatDate(entry.createdAt)}
                            </Text>
                          </Stack>
                          <Text variant="h4">
                            {entry.title ?? 'Untitled entry'}
                          </Text>
                          <Text color="secondary">{entry.content}</Text>
                          <div className="molt-chip-row">
                            {(entry.tags ?? []).slice(0, 3).map((tag) => (
                              <Badge key={tag} variant="default">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </Stack>
                      </button>
                    ))}
                  </div>
                </Stack>
              </Card>
            </div>

            <div className="molt-explore-side">
              <Card variant="surface" padding="md">
                <Stack gap={3}>
                  <Text variant="h4">Recurring groups</Text>
                  <Stack gap={2}>
                    {state.clusters.map((cluster) => (
                      <button
                        key={cluster.id}
                        type="button"
                        className="molt-cluster-card"
                        data-refine-kind="tag"
                        data-refine-value={cluster.tag}
                      >
                        <Stack gap={1}>
                          <Text variant="h4">{cluster.label}</Text>
                          <Text color="muted">{cluster.description}</Text>
                        </Stack>
                      </button>
                    ))}
                  </Stack>
                </Stack>
              </Card>

              <Card variant="surface" padding="md">
                <Stack gap={3}>
                  <Text variant="h4">Timeline</Text>
                  <div className="molt-timeline-bars">
                    {state.timeline.map((bucket) => (
                      <div key={bucket.id} className="molt-timeline-bar">
                        <span>{bucket.label}</span>
                        <div>
                          <em
                            style={{
                              width: `${Math.max(12, bucket.count * 12)}px`,
                            }}
                          />
                        </div>
                        <strong>{bucket.count}</strong>
                      </div>
                    ))}
                  </div>
                </Stack>
              </Card>

              <Card variant="surface" padding="md">
                <Stack gap={3}>
                  <Text variant="h4">Top tags</Text>
                  <div className="molt-chip-row">
                    {state.topTags.map((tag) => (
                      <button
                        key={tag.tag}
                        type="button"
                        className="molt-tag-count"
                        data-refine-kind="tag"
                        data-refine-value={tag.tag}
                      >
                        <span>{tag.tag}</span>
                        <strong>{tag.count}</strong>
                      </button>
                    ))}
                  </div>
                </Stack>
              </Card>
            </div>
          </div>
        </Stack>
      </div>
    </MoltThemeProvider>
  );
}

export function renderExploreSurfaceHtml(state: ExploreSurfaceState): string {
  return renderToStaticMarkup(<ExploreSurface state={state} />);
}
