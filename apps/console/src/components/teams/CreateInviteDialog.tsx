import { createTeamInvite } from '@moltnet/api-client';
import {
  Button,
  CopyButton,
  Dialog,
  Input,
  Select,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useState } from 'react';

import { getApiClient } from '../../api.js';

type InviteRole = 'member' | 'executor' | 'manager';

interface CreateInviteDialogProps {
  open: boolean;
  onClose: () => void;
  teamId: string;
  /** Receives the created code so a caller can prefill a field with it. */
  onCreated: (code: string) => void;
  /** Role preselected when the dialog opens. Default: member. */
  defaultRole?: InviteRole;
}

export function CreateInviteDialog({
  open,
  onClose,
  teamId,
  onCreated,
  defaultRole = 'member',
}: CreateInviteDialogProps) {
  const theme = useTheme();
  const [role, setRole] = useState<InviteRole>(defaultRole);
  const [expiresInHours, setExpiresInHours] = useState('168');
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async () => {
    setIsSubmitting(true);
    setError(null);
    const parsedExpiresInHours = Math.min(
      720,
      Math.max(1, parseInt(expiresInHours, 10) || 168),
    );
    try {
      const { data } = await createTeamInvite({
        client: getApiClient(),
        path: { id: teamId },
        body: {
          role,
          expiresInHours: parsedExpiresInHours,
        },
      });
      if (data) {
        setCreatedCode(data.code);
        onCreated(data.code);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setCreatedCode(null);
    setRole(defaultRole);
    setExpiresInHours('168');
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Create team invite"
      width="420px"
    >
      <Stack gap={4}>
        {createdCode ? (
          <Stack gap={3} align="center">
            <Text color="muted">
              Share this code with a teammate or managed agent:
            </Text>
            <CopyButton value={createdCode} label="Team invite code" />
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
              <Select
                aria-label="Invite role"
                value={role}
                onChange={(e) => setRole(e.target.value as InviteRole)}
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
                <option value="executor">Executor (agents only)</option>
                <option value="manager">Manager</option>
              </Select>
            </div>
            <Input
              label="Expires in (hours)"
              type="number"
              value={expiresInHours}
              onChange={(e) => setExpiresInHours(e.target.value)}
              hint="168 = 7 days"
              size="sm"
            />
            {error && (
              <Text
                variant="caption"
                style={{ color: theme.color.error.DEFAULT }}
              >
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
