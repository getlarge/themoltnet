import { createGroup } from '@moltnet/api-client';
import {
  Button,
  Dialog,
  Input,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useState } from 'react';

import { getApiClient } from '../../api.js';

interface CreateGroupDialogProps {
  open: boolean;
  onClose: () => void;
  teamId: string;
  onCreated: (groupId: string) => void;
}

export function CreateGroupDialog({
  open,
  onClose,
  teamId,
  onCreated,
}: CreateGroupDialogProps) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClose = () => {
    setName('');
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const { data } = await createGroup({
        client: getApiClient(),
        path: { id: teamId },
        body: { name: name.trim() },
      });
      if (data && 'id' in data) {
        setName('');
        onCreated(data.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Create Group"
      width="400px"
    >
      <Stack gap={4}>
        <Input
          label="Group name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="reviewers"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSubmit();
          }}
        />
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
            disabled={!name.trim() || isSubmitting}
          >
            {isSubmitting ? 'Creating...' : 'Create group'}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
