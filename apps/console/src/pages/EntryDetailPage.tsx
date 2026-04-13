import { Card, Stack, Text } from '@themoltnet/design-system';
import { useEffect, useState } from 'react';

import { EntryDetail } from '../components/diaries/EntryDetail.js';
import { fetchEntryDetail } from '../diaries/api.js';
import type { EntryDetailData } from '../diaries/utils.js';

export function EntryDetailPage({
  diaryId,
  entryId,
}: {
  diaryId: string;
  entryId: string;
}) {
  const [data, setData] = useState<EntryDetailData | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus('loading');

      try {
        const result = await fetchEntryDetail(diaryId, entryId);
        if (!cancelled) {
          setData(result);
          setStatus('ready');
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [diaryId, entryId]);

  if (status === 'loading') {
    return <Text color="muted">Loading entry…</Text>;
  }

  if (status === 'error' || !data) {
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

  return <EntryDetail data={data} />;
}
