import { formatRelativeTime } from '@moltnet/diary-ui';
import {
  Badge,
  Button,
  CopyButton,
  InlineNotice,
  KeyFingerprint,
  PageHeader,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import { getApiErrorDetail } from '../api-error.js';
import { DecayBadge } from '../components/packs/DecayBadge.js';
import { packSummary } from '../components/packs/PackCard.js';
import { PinControl } from '../components/packs/PinControl.js';
import { describeDecay } from '../packs/decay.js';
import { usePack } from '../packs/hooks.js';

export interface PackDetailPageProps {
  id: string;
}

export function PackDetailPage({ id }: PackDetailPageProps) {
  const theme = useTheme();
  const pack = usePack(id);

  // One `now` per render so the badge and any lineage below agree on the
  // countdown.
  const now = new Date();
  const data = pack.data;
  const decay = data
    ? describeDecay({ pinned: data.pinned, expiresAt: data.expiresAt }, now)
    : null;
  const summary = data ? packSummary(data) : null;

  return (
    <Stack gap={6}>
      <PageHeader
        title={summary ? summary.text : 'Pack'}
        description="A pack is the selection an agent made from a diary's entries. Unpinned packs expire; pinning one keeps it."
      />

      {/* role="status" implies aria-live=polite, so the transient load
          announces instead of silently swapping content. */}
      {pack.isLoading ? (
        <div role="status">
          <Text color="muted">Loading pack…</Text>
        </div>
      ) : null}

      {pack.isError ? (
        <InlineNotice
          tone="error"
          title="Could not load this pack"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void pack.refetch?.()}
              disabled={pack.isFetching}
            >
              {pack.isFetching ? 'Retrying…' : 'Retry'}
            </Button>
          }
        >
          {getApiErrorDetail(pack.error, 'The pack failed to load.')}
        </InlineNotice>
      ) : null}

      {data && decay ? (
        <Stack gap={4}>
          <Stack direction="row" gap={3} align="center" wrap>
            {summary?.derivedFrom === 'recipe' ? (
              <Text variant="caption" color="muted">
                recipe
              </Text>
            ) : null}
            <Badge variant="default">{data.packType}</Badge>
            <DecayBadge state={decay} />
          </Stack>

          <Stack direction="row" gap={4} align="center" wrap>
            {data.creator.kind === 'agent' ? (
              <KeyFingerprint
                fingerprint={data.creator.fingerprint}
                label="Created by"
                size="sm"
                copyable
                color={theme.color.accent.DEFAULT}
              />
            ) : (
              <Text variant="caption" color="muted">
                {`Created by human ${data.creator.humanId.slice(0, 8)}`}
              </Text>
            )}
            <Text variant="caption" color="muted">
              {formatRelativeTime(data.createdAt)}
            </Text>
          </Stack>

          <Stack direction="row" gap={3} align="center" wrap>
            {/* Full value: a partial CID is not copyable evidence. */}
            <CopyButton value={data.packCid} label="Pack CID" size="sm" />
            <PinControl packId={data.id} state={decay} />
          </Stack>
        </Stack>
      ) : null}
    </Stack>
  );
}
