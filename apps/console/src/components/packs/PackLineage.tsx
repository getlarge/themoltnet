import type { ProvenanceGraphNode } from '@moltnet/models';
import { ProvenanceExplorer } from '@moltnet/provenance-ui';
import { Button, InlineNotice, Stack, Text } from '@themoltnet/design-system';
import { Link } from 'wouter';

import { getApiErrorDetail } from '../../api-error.js';
import { describeDecay } from '../../packs/decay.js';
import { usePackProvenance } from '../../packs/hooks.js';
import { PinControl } from './PinControl.js';

export interface PackLineageProps {
  packId: string;
  now: Date;
  hrefFor?: (packId: string) => string;
}

export function PackLineage({ packId, now, hrefFor }: PackLineageProps) {
  const provenance = usePackProvenance(packId);

  function renderNodeActions(node: ProvenanceGraphNode) {
    if (node.kind !== 'pack') return null;
    return (
      <Stack direction="row" gap={3} align="center" wrap>
        <PinControl
          packId={node.meta.packId}
          state={describeDecay(
            { pinned: node.meta.pinned, expiresAt: node.meta.expiresAt },
            now,
          )}
        />
        {hrefFor && node.meta.packId !== packId ? (
          <Link href={hrefFor(node.meta.packId)}>Open this pack</Link>
        ) : null}
      </Stack>
    );
  }

  return (
    <section aria-labelledby={`pack-provenance-${packId}`}>
      <Stack gap={4}>
        <Stack gap={1}>
          <Text id={`pack-provenance-${packId}`} weight="semibold">
            Provenance
          </Text>
          <Text variant="caption" color="muted">
            The same graph available in the public explorer, with authenticated
            retention controls for packs you can manage.
          </Text>
        </Stack>

        {provenance.isLoading ? (
          <div role="status">
            <Text color="muted">Loading provenance…</Text>
          </div>
        ) : null}

        {provenance.isError ? (
          <InlineNotice
            tone="error"
            title="Could not load provenance"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void provenance.refetch?.()}
                disabled={provenance.isFetching}
              >
                {provenance.isFetching ? 'Retrying…' : 'Retry'}
              </Button>
            }
          >
            {getApiErrorDetail(
              provenance.error,
              'The provenance graph failed to load.',
            )}
          </InlineNotice>
        ) : null}

        {provenance.data ? (
          <ProvenanceExplorer
            graph={provenance.data}
            height="32rem"
            renderNodeActions={renderNodeActions}
          />
        ) : null}
      </Stack>
    </section>
  );
}
