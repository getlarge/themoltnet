import type { ContextPack } from '@moltnet/api-client';
import { formatRelativeTime } from '@moltnet/diary-ui';
import {
  Badge,
  Card,
  CopyButton,
  KeyFingerprint,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { Link } from 'wouter';

import { describeDecay } from '../../packs/decay.js';
import { packSummary } from '../../packs/summary.js';
import { DecayBadge } from './DecayBadge.js';
import { PinControl } from './PinControl.js';

export interface PackCardProps {
  pack: ContextPack;
  now: Date;
  /**
   * Destination for the pack detail, e.g. `/packs/<id>`.
   *
   * A real `href` rather than a click handler: an `<a>` without one is not
   * focusable and not a tab stop, so keyboard users could not open a pack, and
   * open-in-new-tab and copy-link would be lost.
   *
   * Only the title links. The card also carries `CopyButton` and `PinControl`,
   * and nesting interactive controls inside a link is the trap #1883 avoided by
   * keeping them outside the card body.
   */
  href?: string;
}

export function PackCard({ pack, now, href }: PackCardProps) {
  const theme = useTheme();
  const decay = describeDecay(
    { pinned: pack.pinned, expiresAt: pack.expiresAt },
    now,
  );
  const summary = packSummary(pack);

  return (
    <Card variant="outlined" padding="md">
      <Stack gap={4}>
        <Stack direction="row" gap={3} align="center" wrap>
          {/* Prompts run to paragraph length; clamped so one pack cannot turn
              the catalog into a wall of text. */}
          <Text
            weight="semibold"
            style={{
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              overflow: 'hidden',
              maxWidth: '52ch',
            }}
          >
            {href ? (
              <Link
                href={href}
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
                {summary.text}
              </Link>
            ) : (
              summary.text
            )}
          </Text>
          {summary.derivedFrom === 'recipe' ? (
            <Text variant="caption" color="muted">
              recipe
            </Text>
          ) : null}
          <Badge variant="default">{pack.packType}</Badge>
          <DecayBadge state={decay} />
          {pack.supersedesPackId ? (
            <Badge variant="info">Supersedes an earlier pack</Badge>
          ) : null}
        </Stack>

        <Stack direction="row" gap={4} align="center" wrap>
          {pack.creator.kind === 'agent' ? (
            // Identity Amber + mono, via the documented primitive.
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
          {/* Full value, in mono with user-select:all — a partial CID is not
              copyable evidence. */}
          <CopyButton value={pack.packCid} label="Pack CID" size="sm" />
          <PinControl packId={pack.id} state={decay} />
        </Stack>
      </Stack>
    </Card>
  );
}
