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
import { PinControl } from '../components/packs/PinControl.js';
import { describeDecay } from '../packs/decay.js';
import { usePack } from '../packs/hooks.js';
import { packSummary } from '../packs/summary.js';

export interface PackDetailPageProps {
  id: string;
}

export function PackDetailPage({ id }: PackDetailPageProps) {
  const theme = useTheme();
  const packQuery = usePack(id);

  // One `now` per render so every decay surface on this page agrees.
  const now = new Date();
  const pack = packQuery.data;
  const decay = pack
    ? describeDecay({ pinned: pack.pinned, expiresAt: pack.expiresAt }, now)
    : null;
  const summary = pack ? packSummary(pack) : null;

  return (
    <Stack gap={6}>
      <PageHeader
        title={summary ? summary.text : 'Pack'}
        description="A pack is the selection an agent made from a diary's entries. Unpinned packs expire; pinning one keeps it."
      />

      {/* role="status" implies aria-live=polite, so the transient load
          announces instead of silently swapping content. */}
      {packQuery.isLoading ? (
        <div role="status">
          <Text color="muted">Loading pack…</Text>
        </div>
      ) : null}

      {packQuery.isError ? (
        <InlineNotice
          tone="error"
          title="Could not load this pack"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void packQuery.refetch?.()}
              disabled={packQuery.isFetching}
            >
              {packQuery.isFetching ? 'Retrying…' : 'Retry'}
            </Button>
          }
        >
          {getApiErrorDetail(packQuery.error, 'The pack failed to load.')}
        </InlineNotice>
      ) : null}

      {pack && decay ? (
        <Stack gap={4}>
          <Stack direction="row" gap={3} align="center" wrap>
            {summary?.derivedFrom === 'recipe' ? (
              <Text variant="caption" color="muted">
                recipe
              </Text>
            ) : null}
            <Badge variant="default">{pack.packType}</Badge>
            <DecayBadge state={decay} />
          </Stack>

          <Stack direction="row" gap={4} align="center" wrap>
            {pack.creator.kind === 'agent' ? (
              <KeyFingerprint
                fingerprint={pack.creator.fingerprint}
                label="Created by"
                size="sm"
                copyable
                color={theme.color.accent.DEFAULT}
              />
            ) : (
              <Text variant="caption" color="muted">
                {`Created by human ${pack.creator.humanId.slice(0, 8)}`}
              </Text>
            )}
            <Text variant="caption" color="muted">
              {formatRelativeTime(pack.createdAt)}
            </Text>
          </Stack>

          <Stack direction="row" gap={3} align="center" wrap>
            {/* Full value: a partial CID is not copyable evidence. */}
            <CopyButton value={pack.packCid} label="Pack CID" size="sm" />
            <PinControl packId={pack.id} state={decay} />
          </Stack>
        </Stack>
      ) : null}
    </Stack>
  );
}
