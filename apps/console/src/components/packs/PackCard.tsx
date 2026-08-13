import type { ContextPack } from '@moltnet/api-client';
import { formatRelativeTime } from '@moltnet/diary-ui';
import {
  ActionLink,
  Badge,
  Card,
  CopyButton,
  KeyFingerprint,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import { describeDecay } from '../../packs/decay.js';
import { DecayBadge } from './DecayBadge.js';
import { PinControl } from './PinControl.js';

/**
 * `ContextPack` has no `name` column, so the heading is derived from `params`.
 *
 * The producer is `libs/agent-runtime/src/prompts/curate-pack.ts`, which writes
 * `{ recipe, prompt, selection_rationale }` — so `prompt` is the human-readable
 * key and `recipe` is a slug worth showing only when no prompt was recorded.
 * `taskPrompt` is checked too because it is the task-input spelling and a
 * hand-written pack may carry it.
 *
 * `params` is `unknown` on the wire: each candidate is type-checked in turn
 * rather than picked by `??`, which would take a non-string first match and
 * discard a valid sibling.
 */
const SUMMARY_KEYS = ['prompt', 'taskPrompt'] as const;

export function packSummary(pack: Pick<ContextPack, 'id' | 'params'>): {
  text: string;
  derivedFrom: 'prompt' | 'recipe' | 'id';
} {
  const params = pack.params;
  if (params && typeof params === 'object') {
    const record = params as Record<string, unknown>;
    for (const key of SUMMARY_KEYS) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return { text: value.trim(), derivedFrom: 'prompt' };
      }
    }
    const recipe = record.recipe;
    if (typeof recipe === 'string' && recipe.trim()) {
      return { text: recipe.trim(), derivedFrom: 'recipe' };
    }
  }
  return { text: `Pack ${pack.id.slice(0, 8)}`, derivedFrom: 'id' };
}

export interface PackCardProps {
  pack: ContextPack;
  now: Date;
  /**
   * Opens the pack detail. Omitted while `/packs/:id` does not exist — a row
   * must not advertise a destination that resolves to NotFoundPage.
   */
  onOpen?: (packId: string) => void;
}

export function PackCard({ pack, now, onOpen }: PackCardProps) {
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
            {onOpen ? (
              <ActionLink onClick={() => onOpen(pack.id)}>
                {summary.text}
              </ActionLink>
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
