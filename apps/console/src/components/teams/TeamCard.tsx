import { Badge, Card, Stack, Text, useTheme } from '@themoltnet/design-system';
import { Link } from 'wouter';

import type { TeamItem } from '../../team/TeamProvider.js';
import { RoleBadge } from './RoleBadge.js';

export function TeamCard({ team }: { team: TeamItem }) {
  const theme = useTheme();

  return (
    <Link
      href={`/teams/${team.id}`}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <Card
        variant="surface"
        padding="md"
        style={{
          cursor: 'pointer',
          height: '100%',
          transition: theme.transition.fast,
        }}
      >
        <Stack gap={2}>
          <Stack direction="row" gap={2} align="center">
            {team.personal && (
              <Text variant="caption" color="muted">
                ★
              </Text>
            )}
            <Text variant="h4">{team.name}</Text>
          </Stack>
          <Stack direction="row" gap={2} align="center">
            <RoleBadge role={team.role} />
            {team.status !== 'active' && (
              <Badge variant="warning">{team.status}</Badge>
            )}
          </Stack>
        </Stack>
      </Card>
    </Link>
  );
}
