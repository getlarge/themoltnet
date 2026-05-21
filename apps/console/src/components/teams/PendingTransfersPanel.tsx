import {
  acceptTransferMutation,
  listPendingTransfersOptions,
  listPendingTransfersQueryKey,
  rejectTransferMutation,
} from '@moltnet/api-client/query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  ConfirmDialog,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useMemo, useState } from 'react';

import { getApiClient } from '../../api.js';

interface PendingTransfersPanelProps {
  /** Only show transfers whose destinationTeamId matches this team. */
  teamId: string;
}

export function PendingTransfersPanel({ teamId }: PendingTransfersPanelProps) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const query = useQuery({
    ...listPendingTransfersOptions({ client: getApiClient() }),
  });

  const transfersForThisTeam = useMemo(
    () =>
      (query.data?.items ?? []).filter((t) => t.destinationTeamId === teamId),
    [query.data, teamId],
  );

  const [confirming, setConfirming] = useState<{
    transferId: string;
    diaryId: string;
    action: 'accept' | 'reject';
  } | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: listPendingTransfersQueryKey({ client: getApiClient() }),
    });

  const acceptMutation = useMutation({
    ...acceptTransferMutation({ client: getApiClient() }),
    onSettled: () => void invalidate(),
  });
  const rejectMutation = useMutation({
    ...rejectTransferMutation({ client: getApiClient() }),
    onSettled: () => void invalidate(),
  });

  if (query.isLoading) {
    return <Text color="muted">Loading pending transfers…</Text>;
  }

  if (query.error) {
    return (
      <Card padding="md">
        <Text color="muted">Failed to load pending transfers.</Text>
      </Card>
    );
  }

  if (transfersForThisTeam.length === 0) {
    return null;
  }

  const submitConfirmed = () => {
    if (!confirming) return;
    const mutation =
      confirming.action === 'accept' ? acceptMutation : rejectMutation;
    mutation.mutate({ path: { transferId: confirming.transferId } });
    setConfirming(null);
  };

  return (
    <Card padding="md">
      <Stack gap={3}>
        <Text variant="h4">
          Incoming transfers ({transfersForThisTeam.length})
        </Text>
        <Text variant="caption" color="muted">
          Diaries pending acceptance into this team. Accepting reparents the
          diary atomically; rejecting leaves it on its source team.
        </Text>

        <Stack gap={3}>
          {transfersForThisTeam.map((t) => (
            <Card
              key={t.id}
              variant="surface"
              padding="sm"
              style={{ borderColor: theme.color.border.DEFAULT }}
              data-testid={`pending-transfer-${t.id}`}
            >
              <Stack gap={2}>
                <Stack
                  direction="row"
                  justify="space-between"
                  align="center"
                  gap={3}
                  wrap
                >
                  <Stack gap={1}>
                    <Text variant="body" style={{ fontFamily: 'monospace' }}>
                      Diary {t.diaryId}
                    </Text>
                    <Text variant="caption" color="muted">
                      From team {t.sourceTeamId} · initiated{' '}
                      {new Date(t.createdAt).toLocaleString()} · expires{' '}
                      {new Date(t.expiresAt).toLocaleString()}
                    </Text>
                  </Stack>
                  <Stack direction="row" gap={2}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setConfirming({
                          transferId: t.id,
                          diaryId: t.diaryId,
                          action: 'reject',
                        })
                      }
                      disabled={
                        acceptMutation.isPending || rejectMutation.isPending
                      }
                      data-testid={`reject-transfer-${t.id}`}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        setConfirming({
                          transferId: t.id,
                          diaryId: t.diaryId,
                          action: 'accept',
                        })
                      }
                      disabled={
                        acceptMutation.isPending || rejectMutation.isPending
                      }
                      data-testid={`accept-transfer-${t.id}`}
                    >
                      Accept
                    </Button>
                  </Stack>
                </Stack>
              </Stack>
            </Card>
          ))}
        </Stack>

        {(() => {
          const err = acceptMutation.error ?? rejectMutation.error;
          if (!err) return null;
          const message =
            err instanceof Error ? err.message : 'Failed to update transfer';
          return (
            <Text
              variant="caption"
              style={{ color: theme.color.error.DEFAULT }}
            >
              {message}
            </Text>
          );
        })()}
      </Stack>

      {confirming && (
        <ConfirmDialog
          open={true}
          onCancel={() => setConfirming(null)}
          onConfirm={submitConfirmed}
          destructive={confirming.action === 'reject'}
          title={
            confirming.action === 'accept'
              ? 'Accept diary transfer?'
              : 'Reject diary transfer?'
          }
          message={
            confirming.action === 'accept'
              ? `Diary ${confirming.diaryId} will be reparented to this team. This is atomic and cannot be undone except by a new transfer.`
              : `Diary ${confirming.diaryId} will stay on its source team. The initiator can start a new transfer if needed.`
          }
          confirmLabel={confirming.action === 'accept' ? 'Accept' : 'Reject'}
        />
      )}
    </Card>
  );
}
