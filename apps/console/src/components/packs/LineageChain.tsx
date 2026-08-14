import { formatRelativeTime } from '@moltnet/diary-ui';
import {
  ActionLink,
  Badge,
  KeyFingerprint,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import { describeDecay } from '../../packs/decay.js';
import type { Lineage, SpineNode } from '../../packs/lineage.js';
import { DecayBadge } from './DecayBadge.js';
import { PinControl } from './PinControl.js';

export interface LineageChainProps {
  lineage: Lineage;
  now: Date;
  /** Navigates to another pack in the chain. Context packs only. */
  onOpen?: (packId: string) => void;
}

function entryCountLabel(count: number): string {
  return count === 1 ? '1 entry' : `${count} entries`;
}

/**
 * Lineage as a vertical chain, newest first.
 *
 * Rendered as a real `<ol>`: supersession is an ordered sequence, and the
 * accessibility baseline requires the lineage be readable as structure rather
 * than only as a picture. A connector rail carries the visual sequence — not a
 * stack of cards, because this list sits inside the lineage panel and nested
 * cards are never the answer.
 *
 * Every context pack in the chain carries its own pin control, because
 * retention is a chain-level decision: an operator looks at a lineage and
 * concludes "the current one stays, the ancestors it replaced can go". Rendered
 * packs are read-only for now — `usePinRenderedPack` exists but has no control
 * yet (that belongs with #655).
 */
export function LineageChain({ lineage, now, onOpen }: LineageChainProps) {
  const theme = useTheme();

  return (
    <ol
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {lineage.spine.map((node, index) => {
        const isLast = index === lineage.spine.length - 1;
        const rendered = lineage.renderedByPackId[node.id] ?? [];

        return (
          <li key={node.id} style={{ display: 'flex', gap: '16px' }}>
            {/* Connector rail: a 1px line through the sequence, stopping at the
                last node so the chain reads as ending rather than continuing. */}
            <div
              aria-hidden
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                flex: '0 0 auto',
                width: '10px',
              }}
            >
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  marginTop: '6px',
                  background: node.isRoot
                    ? theme.color.text.DEFAULT
                    : theme.color.border.hover,
                }}
              />
              {!isLast ? (
                <span
                  style={{
                    width: '1px',
                    flex: '1 1 auto',
                    minHeight: '24px',
                    background: theme.color.border.DEFAULT,
                  }}
                />
              ) : null}
            </div>

            <Stack gap={2} style={{ paddingBottom: isLast ? 0 : '24px' }}>
              <Stack direction="row" gap={3} align="center" wrap>
                <Text weight={node.isRoot ? 'semibold' : 'normal'}>
                  {node.packId && onOpen && !node.isRoot ? (
                    <ActionLink onClick={() => onOpen(node.packId as string)}>
                      {node.label}
                    </ActionLink>
                  ) : (
                    node.label
                  )}
                </Text>
                {node.isRoot ? <Badge variant="info">Current</Badge> : null}
                <DecayBadge
                  state={describeDecay(
                    { pinned: node.pinned, expiresAt: node.expiresAt },
                    now,
                  )}
                />
              </Stack>

              <Stack direction="row" gap={4} align="center" wrap>
                <Text variant="caption" color="muted">
                  {entryCountLabel(node.entryCount)}
                </Text>
                <Text variant="caption" color="muted">
                  {formatRelativeTime(node.createdAt)}
                </Text>
                {node.creator?.kind === 'agent' ? (
                  <KeyFingerprint
                    fingerprint={node.creator.fingerprint}
                    size="sm"
                    color={theme.color.accent.DEFAULT}
                  />
                ) : null}
              </Stack>

              {rendered.length > 0 ? (
                <RenderedList rendered={rendered} now={now} />
              ) : null}

              {node.packId ? (
                <PinControl
                  packId={node.packId}
                  state={describeDecay(
                    { pinned: node.pinned, expiresAt: node.expiresAt },
                    now,
                  )}
                />
              ) : null}

              {/* Never let a truncated chain read as a complete one. */}
              {node.hasHiddenAncestor ? (
                <Text variant="caption" color="muted">
                  This pack replaced an earlier one that isn’t shown — either
                  beyond the depth requested, or in a diary you can’t read.
                </Text>
              ) : null}
            </Stack>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Rendered outputs of one pack. A separate axis from supersession — one pack
 * can have several renderings at once — so it nests rather than joining the
 * chain.
 */
function RenderedList({ rendered, now }: { rendered: SpineNode[]; now: Date }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {rendered.map((node) => (
        <li key={node.id}>
          <Stack direction="row" gap={3} align="center" wrap>
            <Text variant="caption">{node.label}</Text>
            <DecayBadge
              state={describeDecay(
                { pinned: node.pinned, expiresAt: node.expiresAt },
                now,
              )}
            />
          </Stack>
        </li>
      ))}
    </ul>
  );
}
