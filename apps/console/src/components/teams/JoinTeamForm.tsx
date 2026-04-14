import { joinTeam } from '@moltnet/api-client';
import {
  Button,
  Card,
  Input,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useState } from 'react';

import { getApiClient } from '../../api.js';

interface JoinTeamFormProps {
  onJoined: () => void;
}

export function JoinTeamForm({ onJoined }: JoinTeamFormProps) {
  const theme = useTheme();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleJoin = async () => {
    if (!code.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await joinTeam({
        client: getApiClient(),
        body: { code: code.trim() },
      });
      setCode('');
      onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join team');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card variant="outlined" padding="md">
      <Stack gap={3}>
        <Text
          variant="caption"
          color="muted"
          style={{
            textTransform: 'uppercase',
            letterSpacing: theme.font.letterSpacing.wide,
            fontWeight: theme.font.weight.medium,
          }}
        >
          Join a team
        </Text>
        <Stack direction="row" gap={2} align="flex-end">
          <div style={{ flex: 1 }}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Invite code"
              error={error ?? undefined}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleJoin();
              }}
            />
          </div>
          <Button
            size="md"
            onClick={() => void handleJoin()}
            disabled={!code.trim() || isSubmitting}
          >
            {isSubmitting ? 'Joining...' : 'Join'}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}
