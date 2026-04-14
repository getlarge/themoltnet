import {
  type DiaryCatalog,
  listDiaryGrants,
  type ListDiaryGrantsResponses,
} from '@moltnet/api-client';
import { Button, Card, Stack, Text, useTheme } from '@themoltnet/design-system';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'wouter';

import { getApiClient } from '../../api.js';
import { DiaryGrantsPanel, type SubjectDisplay } from './DiaryGrantsPanel.js';

type Grant = ListDiaryGrantsResponses[200]['grants'][number];

interface TeamDiaryCardProps {
  diary: DiaryCatalog;
  entryCount?: number;
  resolveSubject: (
    subjectId: string,
    subjectNs: Grant['subjectNs'],
  ) => SubjectDisplay;
  canManage: boolean;
  onGrantClick: (diary: DiaryCatalog) => void;
  refreshKey: number;
}

export function TeamDiaryCard({
  diary,
  entryCount,
  resolveSubject,
  canManage,
  onGrantClick,
  refreshKey,
}: TeamDiaryCardProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGrants = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data } = await listDiaryGrants({
        client: getApiClient(),
        path: { id: diary.id },
      });
      setGrants(data?.grants ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load grants');
    } finally {
      setIsLoading(false);
    }
  }, [diary.id]);

  useEffect(() => {
    if (expanded) void loadGrants();
  }, [expanded, loadGrants, refreshKey]);

  return (
    <Card variant="outlined" padding="sm">
      <Stack gap={3}>
        <Stack direction="row" gap={3} align="center" justify="space-between">
          <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
            <Link
              href={`/diaries/${diary.id}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <Text variant="body">{diary.name}</Text>
            </Link>
            <Text variant="caption" color="muted">
              {entryCount !== undefined ? `${entryCount} entries · ` : ''}
              {diary.visibility}
            </Text>
          </Stack>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Hide grants ▴' : 'Show grants ▾'}
          </Button>
        </Stack>

        {expanded && (
          <>
            {isLoading ? (
              <Text variant="caption" color="muted">
                Loading grants…
              </Text>
            ) : error ? (
              <Text
                variant="caption"
                style={{ color: theme.color.error.DEFAULT }}
              >
                {error}
              </Text>
            ) : (
              <DiaryGrantsPanel
                diaryId={diary.id}
                diaryName={diary.name}
                grants={grants}
                resolveSubject={resolveSubject}
                canManage={canManage}
                onChange={() => void loadGrants()}
                onGrantClick={() => onGrantClick(diary)}
              />
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}
