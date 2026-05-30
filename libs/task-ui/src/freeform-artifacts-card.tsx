import { Card, Stack, Text, useTheme } from '@themoltnet/design-system';

/**
 * Loose mirror of `FreeformArtifact` from `@moltnet/tasks`. Kept local so
 * `task-ui` stays free of runtime dependencies on the tasks lib — the
 * console hands us the parsed output blob and we only read what we need.
 */
interface FreeformArtifactLike {
  kind: string;
  title: string;
  description?: string;
  body?: string;
  path?: string;
  url?: string;
}

interface FreeformOutputLike {
  summary?: string;
  artifacts?: FreeformArtifactLike[];
}

export interface FreeformArtifactsCardProps {
  output: FreeformOutputLike | null | undefined;
}

/**
 * Renders the freeform task's structured artifact list with inline bodies.
 * Specific to freeform's output shape so the generic JsonViewer can still
 * be used as a fallback for everything else. Returns null when there are
 * no artifacts, so the caller can render this above JsonViewer without
 * worrying about empty cards.
 */
export function FreeformArtifactsCard({ output }: FreeformArtifactsCardProps) {
  const theme = useTheme();
  const artifacts = output?.artifacts ?? [];
  if (artifacts.length === 0) return null;

  return (
    <Card variant="outlined" padding="md">
      <Stack gap={4}>
        <Text variant="h4" style={{ margin: 0 }}>
          Artifacts
        </Text>
        {artifacts.map((artifact, index) => (
          <Stack key={`${artifact.title}-${index}`} gap={2}>
            <Stack
              direction="row"
              gap={2}
              align="baseline"
              justify="space-between"
              wrap
            >
              <Text variant="bodyLarge" style={{ margin: 0 }}>
                {artifact.title}
              </Text>
              <Text variant="caption" color="muted">
                {artifact.kind}
              </Text>
            </Stack>
            {artifact.description ? (
              <Text variant="caption" color="muted">
                {artifact.description}
              </Text>
            ) : null}
            {artifact.body ? (
              <pre
                style={{
                  margin: 0,
                  padding: theme.spacing[3],
                  borderRadius: theme.radius.md,
                  background: theme.color.bg.surface,
                  border: `1px solid ${theme.color.border.DEFAULT}`,
                  fontFamily: theme.font.family.mono,
                  fontSize: theme.font.size.sm,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  maxHeight: '32rem',
                  overflow: 'auto',
                }}
              >
                {artifact.body}
              </pre>
            ) : null}
            {artifact.url ? (
              <Text variant="caption">
                <a
                  href={artifact.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: theme.color.accent.DEFAULT }}
                >
                  {artifact.url}
                </a>
              </Text>
            ) : null}
            {artifact.path && !artifact.body ? (
              <Text variant="caption" color="muted">
                Path: <code>{artifact.path}</code> — ephemeral; file is not
                persisted after the attempt completes. Use the inline body field
                on next run if the content should be addressable.
              </Text>
            ) : null}
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}
