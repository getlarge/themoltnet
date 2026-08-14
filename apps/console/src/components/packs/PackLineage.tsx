import {
  Button,
  Card,
  InlineNotice,
  Stack,
  Text,
} from '@themoltnet/design-system';

import { getApiErrorDetail } from '../../api-error.js';
import { usePackProvenance } from '../../packs/hooks.js';
import { buildLineage } from '../../packs/lineage.js';
import { LineageChain } from './LineageChain.js';

export interface PackLineageProps {
  packId: string;
  now: Date;
  /** Navigates to another pack in the chain. */
  onOpen?: (packId: string) => void;
}

/**
 * Where a pack came from, and what replaced it.
 *
 * The panel exists to support a retention decision rather than to draw a
 * diagram: every context pack in the chain carries its own pin control, so an
 * operator can act on the ancestors a pack replaced without visiting each one.
 *
 * Always a vertical chain: the provenance endpoint walks one `supersedesPackId`
 * pointer upward per pack and never queries descendants, so lineage cannot
 * branch. See `LineageForm` for why there is no graph form.
 */
export function PackLineage({ packId, now, onOpen }: PackLineageProps) {
  const provenance = usePackProvenance(packId);
  const lineage = provenance.data ? buildLineage(provenance.data) : null;

  return (
    <Card variant="outlined" padding="md">
      <Stack gap={4}>
        <Stack gap={1}>
          <Text weight="semibold">Lineage</Text>
          <Text variant="caption" color="muted">
            Packs are replaced rather than edited. This is the chain this pack
            belongs to, and what each version costs to keep.
          </Text>
        </Stack>

        {provenance.isLoading ? (
          <div role="status">
            <Text color="muted">Loading lineage…</Text>
          </div>
        ) : null}

        {provenance.isError ? (
          <InlineNotice
            tone="error"
            title="Could not load lineage"
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

        {lineage && lineage.form === 'none' ? (
          <Text color="muted">
            Nothing has replaced this pack, and it replaced nothing. A new
            version appears here when a `curate_pack` run supersedes it.
          </Text>
        ) : null}

        {lineage && lineage.form !== 'none' ? (
          <LineageChain lineage={lineage} now={now} onOpen={onOpen} />
        ) : null}
      </Stack>
    </Card>
  );
}
