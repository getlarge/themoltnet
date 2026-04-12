import { getTeam } from '@moltnet/api-client';
import { Badge, Card, Stack, Text, useTheme } from '@themoltnet/design-system';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useSearch } from 'wouter';

import { getApiClient } from '../api.js';
import { useTeam } from '../team/useTeam.js';

interface TeamMember {
  subjectId: string;
  subjectNs: string;
  role: string;
}

interface AgentInfo {
  subjectId: string;
  role: string;
}

export function TeamPage() {
  const { selectedTeam } = useTeam();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const activeTab = params.get('tab') === 'members' ? 'members' : 'agents';

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadTeamData = useCallback(async () => {
    if (!selectedTeam) return;
    setIsLoading(true);
    try {
      const { data } = await getTeam({
        client: getApiClient(),
        path: { id: selectedTeam.id },
      });
      if (!data) return;
      setMembers(data.members);

      const agentMembers = data.members
        .filter((m) => m.subjectNs === 'Agent')
        .map((m) => ({ subjectId: m.subjectId, role: m.role }));
      setAgents(agentMembers);
    } catch {
      // Error state handled by empty lists
    } finally {
      setIsLoading(false);
    }
  }, [selectedTeam]);

  useEffect(() => {
    void loadTeamData();
  }, [loadTeamData]);

  const humanMembers = members.filter((m) => m.subjectNs === 'Human');

  if (!selectedTeam) {
    return <Text color="muted">No team selected</Text>;
  }

  return (
    <Stack gap={6}>
      <Stack gap={1}>
        <Text variant="h2">{selectedTeam.name}</Text>
        <Text color="muted">
          {agents.length} agent{agents.length !== 1 ? 's' : ''},{' '}
          {humanMembers.length} member{humanMembers.length !== 1 ? 's' : ''}
        </Text>
      </Stack>

      {/* Tabs */}
      <Stack direction="row" gap={0}>
        <TabButton
          label="Agents"
          active={activeTab === 'agents'}
          onClick={() => navigate('/team')}
        />
        <TabButton
          label="Members"
          active={activeTab === 'members'}
          onClick={() => navigate('/team?tab=members')}
        />
      </Stack>

      {/* Tab content */}
      {isLoading ? (
        <Text color="muted">Loading...</Text>
      ) : activeTab === 'agents' ? (
        <AgentsTab agents={agents} />
      ) : (
        <MembersTab members={humanMembers} />
      )}
    </Stack>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const theme = useTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: `${theme.spacing[3]} ${theme.spacing[5]}`,
        borderTop: 'none',
        borderLeft: 'none',
        borderRight: 'none',
        borderBottom: active
          ? `2px solid ${theme.color.primary.DEFAULT}`
          : '2px solid transparent',
        color: active ? theme.color.text.DEFAULT : theme.color.text.muted,
        fontFamily: theme.font.family.sans,
        fontSize: theme.font.size.sm,
        fontWeight: active
          ? theme.font.weight.semibold
          : theme.font.weight.normal,
        background: 'none',
        cursor: 'pointer',
        transition: `color ${theme.transition.fast}, border-color ${theme.transition.fast}`,
      }}
    >
      {label}
    </button>
  );
}

function AgentsTab({ agents }: { agents: AgentInfo[] }) {
  if (agents.length === 0) {
    return <Text color="muted">No agents in this team.</Text>;
  }

  return (
    <Stack direction="row" gap={4} wrap>
      {agents.map((agent) => (
        <Card key={agent.subjectId} style={{ padding: '1.5rem', width: 280 }}>
          <Stack gap={4} align="center">
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'var(--molt-bg-surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
                color: 'var(--molt-text-muted)',
              }}
            >
              A
            </div>
            <Text variant="caption" color="muted" mono>
              {agent.subjectId}
            </Text>
            <Badge variant="primary">{agent.role}</Badge>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

function MembersTab({ members }: { members: TeamMember[] }) {
  if (members.length === 0) {
    return <Text color="muted">No human members in this team.</Text>;
  }

  return (
    <Stack gap={3}>
      {members.map((member) => (
        <Card key={member.subjectId} style={{ padding: '1rem' }}>
          <Stack direction="row" align="center" gap={4}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'var(--molt-bg-elevated)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                color: 'var(--molt-text-muted)',
                flexShrink: 0,
              }}
            >
              H
            </div>
            <Text style={{ flex: 1 }}>{member.subjectId}</Text>
            <Badge variant="default">{member.role}</Badge>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
