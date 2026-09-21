import { CopyButton, Stack, Text, useTheme } from '@themoltnet/design-system';

import { ArtifactBody } from './artifact-body.js';
import { compactIdentifier, type FreeformArtifactView } from './task-output.js';

export interface FreeformArtifactListProps {
  artifacts: FreeformArtifactView[];
  /** Heading level used for each artifact title (defaults to h4). */
  titleLevel?: 'h3' | 'h4' | 'h5';
  compactIdentifiers?: boolean;
}

/**
 * Artifacts from a freeform output, each with a readable preview of its
 * inline body and its persistent or external location. Separated by rules
 * rather than nested cards so the list reads as one result.
 */
export function FreeformArtifactList({
  artifacts,
  titleLevel = 'h4',
  compactIdentifiers = false,
}: FreeformArtifactListProps) {
  const theme = useTheme();
  if (artifacts.length === 0) return null;

  return (
    <ul
      aria-label="Artifacts"
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}
    >
      {artifacts.map((artifact, index) => (
        <li
          key={`${artifact.title}-${index}`}
          style={{
            paddingTop: index === 0 ? 0 : theme.spacing[5],
            paddingBottom:
              index === artifacts.length - 1 ? 0 : theme.spacing[5],
            borderTop:
              index === 0 ? 'none' : `1px solid ${theme.color.border.DEFAULT}`,
          }}
        >
          <ArtifactItem
            artifact={artifact}
            titleLevel={titleLevel}
            compactIdentifiers={compactIdentifiers}
          />
        </li>
      ))}
    </ul>
  );
}

function ArtifactItem({
  artifact,
  titleLevel,
  compactIdentifiers,
}: {
  artifact: FreeformArtifactView;
  titleLevel: 'h3' | 'h4' | 'h5';
  compactIdentifiers: boolean;
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
            style={{ maxWidth: '72ch' }}
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
              <Text variant="caption" mono style={{ overflowWrap: 'anywhere' }}>
                <span title={compactIdentifiers ? artifact.cid : undefined}>
                  {compactIdentifiers
                    ? compactIdentifier(artifact.cid)
                    : artifact.cid}
                </span>
              </Text>
              <CopyButton
                value={artifact.cid}
                text="Copy"
                size="sm"
                ariaLabel="Copy artifact CID"
              />
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

const visuallyHidden: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
