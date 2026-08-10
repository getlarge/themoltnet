import { Card, SignatureStatus, Stack, Text } from '@themoltnet/design-system';

import type { EntryType } from '../types.js';
import { formatRelativeTime } from '../utils/format.js';
import { deriveSignatureState } from './AttributionPanel.js';
import { ImportanceIndicator } from './ImportanceIndicator.js';
import { TagChip } from './TagChip.js';
import { TypeBadge } from './TypeBadge.js';

export interface EntryCardEntry {
  id: string;
  title: string | null;
  content: string;
  tags: string[] | null;
  importance: number;
  entryType: EntryType;
  createdAt: string;
  /**
   * Raw content signature, if the source provides it. `string` → the entry
   * carries a signature (shown as "Unverified" in list context — it hasn't been
   * cryptographically checked here; open the entry to verify). `null` → the
   * entry is unsigned. `undefined` → the source didn't supply signature data,
   * so no status is shown (keeps the field backward-compatible for callers that
   * don't populate it).
   */
  contentSignature?: string | null;
}

export interface EntryCardProps {
  entry: EntryCardEntry;
  view?: 'grid' | 'timeline';
  onOpen: (entryId: string) => void;
  /**
   * Optional tag-pivot. When provided, tags render as independent buttons that
   * sit *beside* (not inside) the open-entry action, so there is no nested
   * interactive. Callers that omit this get plain, non-interactive chips.
   */
  onTagClick?: (tag: string) => void;
}

export function EntryCard({
  entry,
  view = 'grid',
  onOpen,
  onTagClick,
}: EntryCardProps) {
  // `view` is retained for callers; grid/timeline differ by their container
  // layout, not by a decorative accent border on the card itself.
  void view;

  // Explicit provenance semantics (this is a security trust signal, so the
  // states must not be implicit):
  //   undefined            → source gave no signature data → show nothing
  //   non-empty string     → a signature exists but wasn't verified here → "Unverified"
  //   null / empty / blank  → no usable signature → "Unsigned"
  //
  // The classification itself lives in `deriveSignatureState` so this card and
  // the entry detail panel can never disagree about what a signature means.
  // A list row has no verification result, hence `verification: null`.
  const showSignatureStatus = entry.contentSignature !== undefined;
  const { state: signatureState } = deriveSignatureState({
    contentSignature: entry.contentSignature ?? null,
    verification: null,
  });

  return (
    <Card
      variant="surface"
      padding="md"
      style={{ position: 'relative', height: '100%' }}
    >
      <Stack gap={3}>
        {/* Open-entry action: wraps only the non-interactive header/title/body.
            The tag buttons live *outside* this button as siblings, so there is
            no invalid nested interactive and each tag receives its own click. */}
        <button
          type="button"
          onClick={() => onOpen(entry.id)}
          aria-label={entry.title ? `Open entry: ${entry.title}` : 'Open entry'}
          style={{
            display: 'block',
            width: '100%',
            margin: 0,
            padding: 0,
            border: 0,
            background: 'transparent',
            textAlign: 'left',
            color: 'inherit',
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          <Stack gap={3}>
            <Stack
              direction="row"
              align="center"
              justify="space-between"
              gap={3}
              wrap
            >
              <Stack direction="row" align="center" gap={2} wrap>
                <TypeBadge type={entry.entryType} />
                {/* Provenance is legible in the list, not only on the detail
                    view (PRODUCT principle 1). Semantics computed above. */}
                {showSignatureStatus && (
                  <SignatureStatus state={signatureState} />
                )}
              </Stack>
              <Text variant="caption" color="muted">
                {formatRelativeTime(entry.createdAt)}
              </Text>
            </Stack>
            {entry.title && <Text variant="h4">{entry.title}</Text>}
            <Text
              color="muted"
              style={{ overflow: 'hidden', maxHeight: '6em' }}
            >
              {entry.content}
            </Text>
          </Stack>
        </button>
        {entry.tags && entry.tags.length > 0 && (
          <Stack
            direction="row"
            gap={2}
            wrap
            style={{ minWidth: 0, overflow: 'hidden' }}
          >
            {entry.tags.slice(0, 6).map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                onClick={
                  onTagClick ? (clicked) => onTagClick(clicked) : undefined
                }
              />
            ))}
          </Stack>
        )}
        <ImportanceIndicator value={entry.importance} />
      </Stack>
    </Card>
  );
}
