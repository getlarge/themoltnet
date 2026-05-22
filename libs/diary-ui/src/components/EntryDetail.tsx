import {
  Card,
  Divider,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';

import type {
  DiaryCatalog,
  DiaryEntryWithRelations,
  EntryVerifyResult,
} from '../types.js';
import { estimateTokenCount, formatDateTime } from '../utils/format.js';
import { ImportanceIndicator } from './ImportanceIndicator.js';
import { TagChip } from './TagChip.js';
import { TypeBadge } from './TypeBadge.js';

export interface EntryDetailData {
  diary: DiaryCatalog | null;
  entry: DiaryEntryWithRelations;
  verification: EntryVerifyResult | null;
}

export interface EntryDetailProps {
  data: EntryDetailData;
  onBack: () => void;
  onTagClick: (tag: string) => void;
  onRelationOpen: (entryId: string) => void;
}

export function EntryDetail({
  data,
  onBack,
  onTagClick,
  onRelationOpen,
}: EntryDetailProps) {
  const theme = useTheme();
  const { diary, entry, verification } = data;

  return (
    <Stack gap={6}>
      <button
        type="button"
        onClick={onBack}
        style={{
          alignSelf: 'flex-start',
          background: 'transparent',
          border: 0,
          padding: 0,
          color: theme.color.text.muted,
          cursor: 'pointer',
          textDecoration: 'none',
          font: 'inherit',
        }}
      >
        &larr; {diary?.name ?? 'Diary'}
      </button>

      <Card variant="elevated" padding="lg">
        <Stack gap={5}>
          <Stack gap={3}>
            <Text variant="h2">{entry.title ?? 'Untitled entry'}</Text>
            <Stack direction="row" gap={3} wrap align="center">
              <TypeBadge type={entry.entryType} />
              <ImportanceIndicator value={entry.importance} />
            </Stack>
          </Stack>

          <Stack gap={2}>
            <MetadataRow
              label="CID"
              value={entry.contentHash ?? 'Not computed'}
              mono
              accent
            />
            <MetadataRow
              label="Signed"
              value={
                verification?.signed
                  ? verification.agentFingerprint
                    ? `Yes · ${verification.agentFingerprint}`
                    : 'Yes'
                  : 'Unsigned'
              }
              mono={!!verification?.agentFingerprint}
              accent={!!verification?.agentFingerprint}
            />
            <MetadataRow
              label="Created"
              value={formatDateTime(entry.createdAt)}
            />
            <MetadataRow
              label="Tokens"
              value={`~${estimateTokenCount(entry.content)}`}
            />
          </Stack>

          {entry.tags && entry.tags.length > 0 && (
            <Stack gap={2}>
              <Text variant="overline" color="muted">
                Tags
              </Text>
              <Stack direction="row" gap={2} wrap>
                {entry.tags.map((tag) => (
                  <TagChip key={tag} tag={tag} onClick={onTagClick} />
                ))}
              </Stack>
            </Stack>
          )}

          <Divider />

          <Text
            variant="bodyLarge"
            color="secondary"
            style={{ whiteSpace: 'pre-wrap' }}
          >
            {entry.content}
          </Text>

          <Divider />

          <Stack gap={2}>
            <Text variant="h4">Relations</Text>
            {entry.relations?.items.length ? (
              <Stack gap={2}>
                {entry.relations.items.map((relation) => {
                  const relatedEntryId =
                    relation.sourceId === entry.id
                      ? relation.targetId
                      : relation.sourceId;

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
                      }}
                    >
                      <Card variant="surface" padding="sm">
                        <Stack direction="row" gap={3} wrap align="center">
                          <Text>{relation.relation}</Text>
                          <Text variant="caption" color="muted" mono>
                            {relatedEntryId}
                          </Text>
                        </Stack>
                      </Card>
                    </button>
                  );
                })}
              </Stack>
            ) : (
              <Text color="muted">No related entries recorded.</Text>
            )}
          </Stack>
        </Stack>
      </Card>
    </Stack>
  );
}

function MetadataRow({
  label,
  value,
  mono = false,
  accent = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <Stack direction="row" gap={3} wrap>
      <Text variant="caption" color="muted">
        {label}
      </Text>
      <Text variant="caption" mono={mono} color={accent ? 'accent' : 'default'}>
        {value}
      </Text>
    </Stack>
  );
}
