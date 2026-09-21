import { Card, Stack, Text } from '@themoltnet/design-system';

import { FreeformArtifactList } from './freeform-artifact-list.js';
import { readFreeformArtifacts } from './task-output.js';

export interface FreeformArtifactsCardProps {
  output: { summary?: unknown; artifacts?: unknown } | null | undefined;
}

/**
 * The freeform artifact list as a standalone card, for the attempt detail
 * page. Returns null when there are no artifacts, so callers can render it
 * above the raw JSON without guarding.
 */
export function FreeformArtifactsCard({ output }: FreeformArtifactsCardProps) {
  const artifacts = readFreeformArtifacts(output);
  if (artifacts.length === 0) return null;

  return (
    <Card variant="outlined" padding="md">
      <Stack gap={4}>
        <Text variant="h4" style={{ margin: 0 }}>
          Artifacts
        </Text>
        <FreeformArtifactList artifacts={artifacts} titleLevel="h5" />
      </Stack>
    </Card>
  );
}
