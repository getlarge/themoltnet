import type { ContextPack } from '@moltnet/api-client';
import { formatRelativeTime } from '@moltnet/diary-ui';
import {
  Badge,
  Card,
  CopyButton,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import { describeDecay } from '../../packs/decay.js';
import { DecayBadge } from './DecayBadge.js';
import { PinControl } from './PinControl.js';

/**
 * `ContextPack` has no `name` column, so the heading is derived from `params`
 * when the curator recorded something usable and falls back to the short id.
 * `params` is `unknown` on the wire — narrow it, never assume a shape.
 */
export function packSummary(pack: Pick<ContextPack, 'id' | 'params'>): string {
  const params = pack.params;
  if (params && typeof params === 'object') {
    const candidate =
      (params as { taskPrompt?: unknown }).taskPrompt ??
      (params as { topic?: unknown }).topic ??
      (params as { recipe?: unknown }).recipe;
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return `Pack ${pack.id.slice(0, 8)}`;
}

export function creatorLabel(pack: Pick<ContextPack, 'creator'>): string {
  const creator = pack.creator;
  return creator.kind === 'agent'
    ? creator.fingerprint
    : `Human ${creator.humanId.slice(0, 8)}`;
}

export interface PackCardProps {
  pack: ContextPack;
  now: Date;
  onOpen: (packId: string) => void;
}

export function PackCard({ pack, now, onOpen }: PackCardProps) {
  const theme = useTheme();
  const decay = describeDecay(
    { pinned: pack.pinned, expiresAt: pack.expiresAt },
    now,
  );

  return (
    <Stack gap={3}>
      <Card interactive onClick={() => onOpen(pack.id)} padding="md">
        <Stack gap={3}>
          <Stack direction="row" gap={3} align="center" wrap>
            <Text weight="semibold">{packSummary(pack)}</Text>
            <Badge variant="default">{pack.packType}</Badge>
            <DecayBadge state={decay} />
            {pack.supersedesPackId ? (
              <Badge variant="info">Supersedes an earlier pack</Badge>
            ) : null}
          </Stack>

          <Stack direction="row" gap={4} align="center" wrap>
            {/* Identity Amber: who attests. Constraint 5. */}
            <Text
              variant="caption"
              style={{ color: theme.color.accent.DEFAULT }}
            >
              {creatorLabel(pack)}
            </Text>
            <Text variant="caption" color="muted">
              Created {formatRelativeTime(pack.createdAt)}
            </Text>
          </Stack>
        </Stack>
      </Card>

      <Stack direction="row" gap={3} align="center" wrap>
        {/* Renders the CID itself in mono with user-select:all; not truncated,
            because a partial CID is not copyable evidence. */}
        <CopyButton value={pack.packCid} label="Pack CID" size="sm" />
        <PinControl packId={pack.id} pinned={pack.pinned} />
      </Stack>
    </Stack>
  );
}
