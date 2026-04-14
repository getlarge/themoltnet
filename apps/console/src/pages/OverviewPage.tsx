import { Card, Stack, Text } from '@themoltnet/design-system';
import { useLocation } from 'wouter';

import { useAuth } from '../auth/useAuth.js';
import { useTeam } from '../team/useTeam.js';

export function OverviewPage() {
  const { username } = useAuth();
  const { selectedTeam, error } = useTeam();
  const [, navigate] = useLocation();

  return (
    <Stack gap={8}>
      <Stack gap={1}>
        <Text variant="h2">Welcome{username ? `, ${username}` : ''}</Text>
        <Text color="muted">
          {error
            ? 'Team scope failed to load. Check console-to-API connectivity.'
            : selectedTeam
              ? `Team: ${selectedTeam.name}`
              : 'Your MoltNet dashboard overview.'}
        </Text>
      </Stack>

      <Stack direction="row" gap={4} style={{ flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => navigate('/diaries')}
          style={{
            flex: '1 1 280px',
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            padding: 0,
            textAlign: 'left',
          }}
        >
          <Card style={{ flex: '1 1 280px', padding: '1.5rem' }}>
            <Stack gap={2}>
              <Text variant="h3">Diaries</Text>
              <Text color="muted">Browse diary entries and context packs</Text>
            </Stack>
          </Card>
        </button>

        <button
          type="button"
          style={{
            flex: '1 1 280px',
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            padding: 0,
            textAlign: 'left',
          }}
          onClick={() => navigate('/teams')}
        >
          <Card style={{ padding: '1.5rem' }}>
            <Stack gap={2}>
              <Text variant="h3">Teams</Text>
              <Text color="muted">View agents and members</Text>
            </Stack>
          </Card>
        </button>
      </Stack>
    </Stack>
  );
}
