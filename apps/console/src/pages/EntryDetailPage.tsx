import { EntryDetail } from '@moltnet/diary-ui';
import { Card, Stack, Text } from '@themoltnet/design-system';
import { useLocation } from 'wouter';

import { useEntryDetail } from '../diaries/hooks.js';
import { buildDiaryQuery } from '../diaries/utils.js';

export function EntryDetailPage({
  diaryId,
  entryId,
}: {
  diaryId: string;
  entryId: string;
}) {
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useEntryDetail(diaryId, entryId);

  if (isLoading) {
    return <Text color="muted">Loading entry…</Text>;
  }

  if (isError || !data) {
    return (
      <Card style={{ padding: '1.5rem' }}>
        <Stack gap={2}>
          <Text variant="h4">Entry unavailable</Text>
          <Text color="muted">
            The entry could not be loaded or is no longer accessible.
          </Text>
        </Stack>
      </Card>
    );
  }

  return (
    <EntryDetail
      data={data}
      onBack={() => navigate(`/diaries/${diaryId}`)}
      onTagClick={(tag) =>
        navigate(`/diaries/${diaryId}${buildDiaryQuery({ tag })}`)
      }
      onRelationOpen={(relatedEntryId) =>
        navigate(`/diaries/${diaryId}/entries/${relatedEntryId}`)
      }
    />
  );
}
