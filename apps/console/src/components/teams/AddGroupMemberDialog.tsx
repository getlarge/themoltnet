import { addGroupMember } from '@moltnet/api-client';
import {
  Button,
  Dialog,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useEffect, useMemo, useState } from 'react';

import { getApiClient } from '../../api.js';

export interface AddGroupMemberCandidate {
  subjectId: string;
  subjectType: 'agent' | 'human';
  displayName: string;
  fingerprint?: string;
  email?: string;
}

interface AddGroupMemberDialogProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  candidates: AddGroupMemberCandidate[];
  onAdded: () => void;
}

export function AddGroupMemberDialog({
  open,
  onClose,
  groupId,
  candidates,
  onAdded,
}: AddGroupMemberDialogProps) {
  const theme = useTheme();
  const [selected, setSelected] = useState<string>(
    () => candidates[0]?.subjectId ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedCandidate = useMemo(
    () => candidates.find((c) => c.subjectId === selected) ?? null,
    [candidates, selected],
  );

  // Keep `selected` in sync with `candidates`: the dialog is mounted even when
  // closed, so the initial state captured on first render often has an empty
  // candidate list. Default to the first candidate whenever the current
  // selection isn't present in the list.
  useEffect(() => {
    if (candidates.length === 0) {
      if (selected !== '') setSelected('');
      return;
    }
    const first = candidates[0];
    if (first && !candidates.some((c) => c.subjectId === selected)) {
      setSelected(first.subjectId);
    }
  }, [candidates, selected]);

  const handleClose = () => {
    setError(null);
    setSelected(candidates[0]?.subjectId ?? '');
    onClose();
  };

  const handleSubmit = async () => {
    if (!selectedCandidate) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await addGroupMember({
        client: getApiClient(),
        path: { groupId },
        body: {
          subjectId: selectedCandidate.subjectId,
          subjectNs:
            selectedCandidate.subjectType === 'human' ? 'Human' : 'Agent',
        },
      });
      onAdded();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} title="Add Member" width="420px">
      <Stack gap={4}>
        {candidates.length === 0 ? (
          <Text color="muted">All team members are already in this group.</Text>
        ) : (
          <>
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
                Team member
              </Text>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
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
                {candidates.map((c) => (
                  <option key={c.subjectId} value={c.subjectId}>
                    {c.subjectType === 'agent' ? '🤖 ' : '👤 '}
                    {c.displayName}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {error && (
          <Text variant="caption" style={{ color: theme.color.error.DEFAULT }}>
            {error}
          </Text>
        )}
        <Stack direction="row" gap={3} justify="flex-end">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={!selectedCandidate || isSubmitting}
          >
            {isSubmitting ? 'Adding...' : 'Add member'}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
