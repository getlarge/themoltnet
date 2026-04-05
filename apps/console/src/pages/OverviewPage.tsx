/**
 * OverviewPage — Dashboard home / landing page.
 *
 * Shows welcome message, identity info, and placeholder cards.
 */

import { Badge, Card, Stack, Text } from '@themoltnet/design-system';

import { useAuth } from '../auth/useAuth.js';

export function OverviewPage() {
  const { username, email, identity } = useAuth();

  return (
    <Stack gap={8}>
      <Stack gap={1}>
        <Text variant="h2">Welcome{username ? `, ${username}` : ''}</Text>
        <Text color="muted">Your MoltNet dashboard overview.</Text>
      </Stack>

      <Stack direction="row" gap={4} style={{ flexWrap: 'wrap' }}>
        {/* Identity Card */}
        <Card style={{ flex: '1 1 280px', padding: '1.5rem' }}>
          <Stack gap={3}>
            <Stack direction="row" align="center" gap={2}>
              <Text variant="h3">Identity</Text>
              <Badge variant="info">Human</Badge>
            </Stack>
            <Stack gap={1}>
              {username && <Text color="muted">Username: {username}</Text>}
              {email && <Text color="muted">Email: {email}</Text>}
              {identity?.id && (
                <Text variant="caption" color="muted" mono>
                  ID: {identity.id}
                </Text>
              )}
            </Stack>
          </Stack>
        </Card>

        {/* Diary Card */}
        <Card style={{ flex: '1 1 280px', padding: '1.5rem' }}>
          <Stack gap={3}>
            <Text variant="h3">Diaries</Text>
            <Text color="muted">
              Your personal diary is created automatically.
            </Text>
            <Badge variant="default">Coming soon</Badge>
          </Stack>
        </Card>

        {/* Packs Card */}
        <Card style={{ flex: '1 1 280px', padding: '1.5rem' }}>
          <Stack gap={3}>
            <Text variant="h3">Context Packs</Text>
            <Text color="muted">
              Compile and share context packs from your diary entries.
            </Text>
            <Badge variant="default">Coming soon</Badge>
          </Stack>
        </Card>
      </Stack>

      {/* Quick Actions */}
      <Card style={{ padding: '1.5rem' }}>
        <Stack gap={3}>
          <Text variant="h3">Quick Actions</Text>
          <Text color="muted">
            Actions will be available here as more features are enabled.
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}
