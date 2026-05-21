import { initiateTransferMutation } from '@moltnet/api-client/query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useEffect, useMemo, useState } from 'react';

import { getApiClient } from '../../api.js';
import type { TeamItem } from '../../team/TeamProvider.js';

interface TransferDiaryDialogProps {
  open: boolean;
  onClose: () => void;
  diaryId: string;
  diaryName: string;
  sourceTeamId: string;
  teams: TeamItem[];
  onInitiated?: () => void;
}

export function TransferDiaryDialog({
  open,
  onClose,
  diaryId,
  diaryName,
  sourceTeamId,
  teams,
  onInitiated,
}: TransferDiaryDialogProps) {
  const theme = useTheme();
  const queryClient = useQueryClient();

  // Candidate destination teams: anything the user belongs to that isn't the
  // source team and isn't a personal team (REST rejects personal destinations).
  const candidates = useMemo(
    () => teams.filter((t) => t.id !== sourceTeamId && !t.personal),
    [teams, sourceTeamId],
  );

  const [selected, setSelected] = useState<string>(
    () => candidates[0]?.id ?? '',
  );

  useEffect(() => {
    const first = candidates[0];
    if (!first) {
      if (selected !== '') setSelected('');
      return;
    }
    if (!candidates.some((c) => c.id === selected)) {
      setSelected(first.id);
    }
  }, [candidates, selected]);

  const mutation = useMutation({
    ...initiateTransferMutation({ client: getApiClient() }),
    onSuccess: () => {
      // Invalidate pending transfers so destination team owners see the new
      // pending transfer immediately on refocus.
      void queryClient.invalidateQueries({
        queryKey: ['listPendingTransfers'],
      });
      onInitiated?.();
      handleClose();
    },
  });

  const handleClose = () => {
    mutation.reset();
    setSelected(candidates[0]?.id ?? '');
    onClose();
  };

  const handleSubmit = () => {
    if (!selected) return;
    mutation.mutate({
      path: { id: diaryId },
      body: { destinationTeamId: selected },
    });
  };

  const errorMessage = mutation.error
    ? mutation.error instanceof Error
      ? mutation.error.message
      : 'Failed to initiate transfer'
    : null;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Transfer diary"
      width="440px"
    >
      <Stack gap={4}>
        <Text color="muted">
          Transfer <strong>{diaryName}</strong> to another team. The diary
          remains here until the destination team&apos;s owner accepts.
          Rejection or 7-day expiry cancels the transfer.
        </Text>

        {candidates.length === 0 ? (
          <Text color="muted">
            You are not a member of any non-personal team that could receive
            this diary.
          </Text>
        ) : (
          <div>
            <Text
              variant="caption"
              color="muted"
              style={{
                display: 'block',
                marginBottom: theme.spacing[1],
                textTransform: 'uppercase',
                letterSpacing: theme.font.letterSpacing.wide,
                fontWeight: theme.font.weight.medium,
              }}
            >
              Destination team
            </Text>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              data-testid="transfer-destination-team"
              style={{
                width: '100%',
                padding: `${theme.spacing[2]} ${theme.spacing[3]}`,
                backgroundColor: theme.color.bg.surface,
                color: theme.color.text.DEFAULT,
                border: `1px solid ${theme.color.border.DEFAULT}`,
                borderRadius: theme.radius.sm,
                fontSize: theme.font.size.sm,
                fontFamily: 'inherit',
              }}
            >
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.role})
                </option>
              ))}
            </select>
          </div>
        )}

        {errorMessage && (
          <Text
            variant="caption"
            data-testid="transfer-error"
            style={{ color: theme.color.error.DEFAULT }}
          >
            {errorMessage}
          </Text>
        )}

        <Stack direction="row" gap={3} justify="flex-end">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!selected || mutation.isPending}
            data-testid="transfer-submit"
          >
            {mutation.isPending ? 'Initiating…' : 'Initiate transfer'}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
