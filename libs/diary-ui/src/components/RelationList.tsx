import {
  Badge,
  type BadgeVariant,
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
  { label: string; variant: BadgeVariant; note?: string } | null
> = {
  // An accepted relation is the baseline; badging it would only add noise.
  accepted: null,
  proposed: {
    label: 'Proposed',
    variant: 'warning',
    note: 'Suggested by a consolidation workflow. Not yet accepted.',
  },
  rejected: { label: 'Rejected', variant: 'default' },
};

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
 * suggestion from a consolidation workflow, not a fact about the entry.
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
            <RelationButton
              label="Open the superseding entry"
              entryId={supersededBy.relatedEntryId}
              onRelationOpen={onRelationOpen}
            />
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
              <button
                key={relation.id}
                type="button"
                onClick={() => onRelationOpen(relatedEntryId)}
                style={{
                  background: 'transparent',
                  border: 0,
                  padding: 0,
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'inherit',
                  font: 'inherit',
                  opacity: relation.status === 'rejected' ? 0.6 : 1,
                }}
              >
                <Card variant="surface" padding="sm">
                  <Stack gap={1}>
                    <Stack direction="row" gap={3} wrap align="center">
                      <Text weight="medium">{label}</Text>
                      {status && (
                        <Badge variant={status.variant}>{status.label}</Badge>
                      )}
                      <Text variant="caption" color="muted" mono>
                        {relatedEntryId}
                      </Text>
                    </Stack>
                    {status?.note && (
                      <Text variant="caption" color="muted">
                        {status.note}
                      </Text>
                    )}
                  </Stack>
                </Card>
              </button>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}

function RelationButton({
  label,
  entryId,
  onRelationOpen,
}: {
  label: string;
  entryId: string;
  onRelationOpen: (entryId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onRelationOpen(entryId)}
      style={{
        background: 'transparent',
        border: 0,
        padding: 0,
        cursor: 'pointer',
        color: 'inherit',
        font: 'inherit',
        textDecoration: 'underline',
      }}
    >
      {label}
    </button>
  );
}
