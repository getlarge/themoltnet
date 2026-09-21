import { Stack, Text, useTheme } from '@themoltnet/design-system';

import { ArtifactBody } from './artifact-body.js';
import { Identifier } from './identifier.js';
import { MEASURE, RuledList, visuallyHidden } from './layout.js';
import type { FreeformArtifactView } from './task-output.js';

export interface FreeformArtifactListProps {
  artifacts: FreeformArtifactView[];
  /** Heading level used for each artifact title (defaults to h4). */
  titleLevel?: 'h4' | 'h5';
}

/**
 * Artifacts from a freeform output, each with a readable preview of its
 * inline body and its persistent or external location. Separated by rules
 * rather than nested cards so the list reads as one result.
 */
export function FreeformArtifactList({
  artifacts,
  titleLevel = 'h4',
}: FreeformArtifactListProps) {
  if (artifacts.length === 0) return null;

  return (
    <RuledList label="Artifacts" gap={5}>
      {artifacts.map((artifact, index) => (
        <ArtifactItem
          key={`${artifact.title}-${index}`}
          artifact={artifact}
          titleLevel={titleLevel}
        />
      ))}
    </RuledList>
  );
}

function ArtifactItem({
  artifact,
  titleLevel,
}: {
  artifact: FreeformArtifactView;
  titleLevel: 'h4' | 'h5';
}) {
  const theme = useTheme();
  const meta = [
    artifact.kind,
    artifact.contentType,
    artifact.sizeBytes !== undefined ? formatBytes(artifact.sizeBytes) : null,
  ].filter(Boolean);
  const hasLocation = Boolean(artifact.url || artifact.cid || artifact.path);

  return (
    <Stack gap={3}>
      <Stack gap={1}>
        <Text
          as={titleLevel}
          variant="body"
          weight="semibold"
          style={{ fontSize: theme.font.size.lg, margin: 0 }}
        >
          {artifact.title}
        </Text>
        <Text variant="caption" color="muted" mono>
          {meta.join(' · ')}
        </Text>
        {artifact.description ? (
          <Text
            variant="caption"
            color="secondary"
            style={{ maxWidth: MEASURE }}
          >
            {artifact.description}
          </Text>
        ) : null}
      </Stack>

      {artifact.body ? (
        <ArtifactBody
          body={artifact.body}
          contentType={artifact.contentType}
          kind={artifact.kind}
        />
      ) : null}

      {hasLocation ? (
        <Stack gap={2}>
          {artifact.url ? (
            <Text variant="caption" style={{ overflowWrap: 'anywhere' }}>
              <a
                href={artifact.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: theme.color.primary.DEFAULT }}
              >
                {artifact.url}
                <span style={visuallyHidden}> (opens in a new tab)</span>
              </a>
            </Text>
          ) : null}
          {artifact.cid ? (
            <Stack direction="row" gap={2} align="center" wrap>
              <Text variant="caption" color="muted">
                Stored artifact
              </Text>
              <Text variant="caption">
                <Identifier
                  value={artifact.cid}
                  copyLabel="Copy artifact CID"
                />
              </Text>
            </Stack>
          ) : null}
          {artifact.path && !artifact.body ? (
            <Text variant="caption" color="muted">
              Path <code>{artifact.path}</code> was ephemeral: the file is not
              kept after the attempt completes.
            </Text>
          ) : null}
        </Stack>
      ) : null}

      {!artifact.body && !hasLocation ? (
        <Text variant="caption" color="muted">
          No content or location was attached to this artifact.
        </Text>
      ) : null}
    </Stack>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
