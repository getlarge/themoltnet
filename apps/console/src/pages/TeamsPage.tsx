import { Button, Stack, Text, useTheme } from '@themoltnet/design-system';
import { useState } from 'react';
import { useLocation } from 'wouter';

import { CreateTeamDialog } from '../components/teams/CreateTeamDialog.js';
import { JoinTeamForm } from '../components/teams/JoinTeamForm.js';
import { TeamCard } from '../components/teams/TeamCard.js';
import { useTeam } from '../team/useTeam.js';

export function TeamsPage() {
  const theme = useTheme();
  const { teams, isLoading, error, refreshTeams } = useTeam();
  const [, navigate] = useLocation();
  const [showCreate, setShowCreate] = useState(false);

  const sortedTeams = [...teams].sort((a, b) => {
    if (a.personal && !b.personal) return -1;
    if (!a.personal && b.personal) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <Stack gap={6}>
      <Stack direction="row" justify="space-between" align="center">
        <Text variant="h2">Teams</Text>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          Create team
        </Button>
      </Stack>

      {isLoading ? (
        <Text color="muted">Loading teams...</Text>
      ) : error ? (
        <Text color="muted">Failed to load teams.</Text>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: theme.spacing[4],
          }}
        >
          {sortedTeams.map((team) => (
            <TeamCard key={team.id} team={team} />
          ))}
        </div>
      )}

      <JoinTeamForm onJoined={() => void refreshTeams()} />

      <CreateTeamDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(teamId) => {
          setShowCreate(false);
          void refreshTeams().then(() => navigate(`/teams/${teamId}`));
        }}
      />
    </Stack>
  );
}
