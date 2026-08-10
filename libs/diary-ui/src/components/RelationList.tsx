import {
  Badge,
  type BadgeVariant,
  Button,
  Card,
  InlineNotice,
  Stack,
  Text,
} from '@themoltnet/design-system';

import type {
  EntryRelationWithDepth,
  RelationStatus,
  RelationType,
} from '../types.js';

export interface RelationListProps {
  /** The entry the list is rendered for — it fixes the direction of each edge. */
  entryId: string;
  /**
   * Relations as returned by `expand=relations`. Anything past the first hop is
   * dropped: `entry_relations` is explicitly **not** acyclic, so a transitive
   * walk has no termination guarantee and no meaning to render.
   */
  relations: EntryRelationWithDepth[] | undefined;
  onRelationOpen: (entryId: string) => void;
}

/**
 * How a relation reads from each end. A `supersedes` edge means something very
 * different to its source ("Supersedes") than to its target ("Superseded by"),
 * and the direction is the whole point of the signal.
 */
const RELATION_LABELS: Record<
  RelationType,
  { outgoing: string; incoming: string }
> = {
  supersedes: { outgoing: 'Supersedes', incoming: 'Superseded by' },
  elaborates: { outgoing: 'Elaborates', incoming: 'Elaborated by' },
  contradicts: { outgoing: 'Contradicts', incoming: 'Contradicted by' },
  supports: { outgoing: 'Supports', incoming: 'Supported by' },
  caused_by: { outgoing: 'Caused by', incoming: 'Caused' },
  references: { outgoing: 'References', incoming: 'Referenced by' },
};

const STATUS_META: Record<
  RelationStatus,
  { label: string; variant: BadgeVariant } | null
> = {
  // An accepted relation is the baseline; badging it would only add noise.
  accepted: null,
  proposed: { label: 'Proposed', variant: 'warning' },
  rejected: { label: 'Rejected', variant: 'default' },
};

/**
 * Proposals come from consolidation workflows *and* from editors creating them
 * by hand, and `workflowId` is nullable — so the origin is only stated when the
 * record actually carries one.
 */
function proposalNote(workflowId: string | null): string {
  return workflowId
    ? 'Suggested by a workflow. Not yet accepted.'
    : 'Suggested. Not yet accepted.';
}

/** Accepted first, then proposals, then rejections. Stable within each group. */
const STATUS_ORDER: Record<RelationStatus, number> = {
  accepted: 0,
  proposed: 1,
  rejected: 2,
};

/**
 * One-hop relations for a diary entry.
 *
 * This is the Decay phase at entry level: the single most important thing the
 * list can say is that an entry has been superseded, and it says that only for
 * an **accepted** `supersedes` edge pointing at this entry. A proposal is a
 * suggestion, not a fact about the entry.
 */
export function RelationList({
  entryId,
  relations,
  onRelationOpen,
}: RelationListProps) {
  const directRelations = (relations ?? [])
    .filter((relation) => relation.depth === 1)
    .map((relation) => ({
      relation,
      isIncoming: relation.targetId === entryId,
      relatedEntryId:
        relation.sourceId === entryId ? relation.targetId : relation.sourceId,
    }))
    .sort(
      (a, b) =>
        STATUS_ORDER[a.relation.status] - STATUS_ORDER[b.relation.status],
    );

  const supersededBy = directRelations.find(
    ({ relation, isIncoming }) =>
      isIncoming &&
      relation.relation === 'supersedes' &&
      relation.status === 'accepted',
  );

  return (
    <Stack gap={3}>
      <Text variant="h4">Relations</Text>

      {supersededBy && (
        <InlineNotice tone="warning" title="Superseded">
          <Stack gap={2} align="flex-start">
            <Text variant="caption">
              A newer entry replaces this one. Prefer the superseding entry
              unless you are reading history.
            </Text>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRelationOpen(supersededBy.relatedEntryId)}
            >
              Open the superseding entry
            </Button>
          </Stack>
        </InlineNotice>
      )}

      {directRelations.length === 0 ? (
        <Text color="muted">No related entries recorded.</Text>
      ) : (
        <Stack gap={2}>
          {directRelations.map(({ relation, isIncoming, relatedEntryId }) => {
            const label =
              RELATION_LABELS[relation.relation][
                isIncoming ? 'incoming' : 'outgoing'
              ];
            const status = STATUS_META[relation.status];

            return (
              // `Card interactive` is the design-system action surface: it
              // renders a native button with the style reset, hover border,
              // focus ring and 44px touch target already handled.
              <Card
                key={relation.id}
                variant="surface"
                padding="sm"
                interactive
                onClick={() => onRelationOpen(relatedEntryId)}
              >
                <Stack gap={1}>
                  <Stack direction="row" gap={3} wrap align="center">
                    <Text
                      weight="medium"
                      style={
                        relation.status === 'rejected'
                          ? { textDecoration: 'line-through' }
                          : undefined
                      }
                    >
                      {label}
                    </Text>
                    {status && (
                      <Badge variant={status.variant}>{status.label}</Badge>
                    )}
                    <Text variant="caption" color="muted" mono>
                      {relatedEntryId}
                    </Text>
                  </Stack>
                  {relation.status === 'proposed' && (
                    <Text variant="caption" color="muted">
                      {proposalNote(relation.workflowId)}
                    </Text>
                  )}
                </Stack>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
