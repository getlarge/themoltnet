import { createTeamInvite } from '@moltnet/api-client';
import {
  Button,
  CopyButton,
  Dialog,
  Input,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useState } from 'react';

import { getApiClient } from '../../api.js';

interface CreateInviteDialogProps {
  open: boolean;
  onClose: () => void;
  teamId: string;
  onCreated: () => void;
}

export function CreateInviteDialog({
  open,
  onClose,
  teamId,
  onCreated,
}: CreateInviteDialogProps) {
  const theme = useTheme();
  const [role, setRole] = useState<'member' | 'manager'>('member');
  const [maxUses, setMaxUses] = useState('1');
  const [expiresInHours, setExpiresInHours] = useState('168');
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const { data } = await createTeamInvite({
        client: getApiClient(),
        path: { id: teamId },
        body: {
          role,
          maxUses: parseInt(maxUses, 10) || 1,
          expiresInHours: parseInt(expiresInHours, 10) || 168,
        },
      });
      if (data) {
        setCreatedCode(data.code);
        onCreated();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setCreatedCode(null);
    setRole('member');
    setMaxUses('1');
    setExpiresInHours('168');
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Create Invite"
      width="420px"
    >
      <Stack gap={4}>
        {createdCode ? (
          <Stack gap={3} align="center">
            <Text color="muted">Share this code with the invitee:</Text>
            <CopyButton value={createdCode} label="Invite code" />
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Done
            </Button>
          </Stack>
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
                Role
              </Text>
              <select
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as 'member' | 'manager')
                }
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
                <option value="member">Member</option>
                <option value="manager">Manager</option>
              </select>
            </div>
            <Input
              label="Max uses"
              type="number"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              inputSize="sm"
            />
            <Input
              label="Expires in (hours)"
              type="number"
              value={expiresInHours}
              onChange={(e) => setExpiresInHours(e.target.value)}
              hint="168 = 7 days"
              inputSize="sm"
            />
            {error && (
              <Text variant="caption" color="muted">
                {error}
              </Text>
            )}
            <Stack direction="row" gap={3} justify="flex-end">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleCreate()}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Creating...' : 'Create invite'}
              </Button>
            </Stack>
          </>
        )}
      </Stack>
    </Dialog>
  );
}
