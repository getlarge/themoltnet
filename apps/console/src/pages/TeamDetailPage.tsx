import {
  deleteTeamInvite,
  getTeam,
  listTeamInvites,
  removeTeamMember,
} from '@moltnet/api-client';
import {
  Button,
  Card,
  ConfirmDialog,
  Divider,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';

import { getApiClient } from '../api.js';
import { CreateInviteDialog } from '../components/teams/CreateInviteDialog.js';
import { InviteCard } from '../components/teams/InviteCard.js';
import { MemberRow } from '../components/teams/MemberRow.js';
import { useTeam } from '../team/useTeam.js';

interface TeamMember {
  subjectId: string;
  subjectType: 'agent' | 'human';
  role: string;
  displayName: string;
  fingerprint?: string;
  email?: string;
}

interface TeamInvite {
  id: string;
  code: string;
  role: string;
  maxUses: number;
  useCount: number;
  expiresAt: string;
  createdAt: string;
}

interface TeamDetail {
  id: string;
  name: string;
  status: string;
  personal: boolean;
  members: TeamMember[];
}

export function TeamDetailPage({ id }: { id: string }) {
  const { teams } = useTeam();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const activeTab = params.get('tab') === 'invites' ? 'invites' : 'members';

  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [showCreateInvite, setShowCreateInvite] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<TeamMember | null>(null);
  const [confirmDeleteInvite, setConfirmDeleteInvite] = useState<string | null>(
    null,
  );

  const callerTeam = teams.find((t) => t.id === id);
  const callerRole = callerTeam?.role ?? 'member';
  const canManage = callerRole === 'owners' || callerRole === 'managers';

  const loadTeam = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data } = await getTeam({
        client: getApiClient(),
        path: { id },
      });
      if (data) {
        setTeam(data as unknown as TeamDetail);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load team'));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  const loadInvites = useCallback(async () => {
    if (!canManage) return;
    try {
      const { data } = await listTeamInvites({
        client: getApiClient(),
        path: { id },
      });
      if (data) {
        setInvites(data.items as unknown as TeamInvite[]);
      }
    } catch {
      // Non-critical — invites tab just won't show data
    }
  }, [id, canManage]);

  useEffect(() => {
    void loadTeam();
    void loadInvites();
  }, [loadTeam, loadInvites]);

  const handleRemoveMember = async (member: TeamMember) => {
    try {
      await removeTeamMember({
        client: getApiClient(),
        path: { id, subjectId: member.subjectId },
      });
      void loadTeam();
    } catch {
      // TODO: show error feedback
    }
    setConfirmRemove(null);
  };

  const handleDeleteInvite = async (inviteId: string) => {
    try {
      await deleteTeamInvite({
        client: getApiClient(),
        path: { id, inviteId },
      });
      void loadInvites();
    } catch {
      // TODO: show error feedback
    }
    setConfirmDeleteInvite(null);
  };

  if (isLoading) return <Text color="muted">Loading...</Text>;
  if (error || !team) {
    return (
      <Card padding="md">
        <Stack gap={3}>
          <Text color="muted">Failed to load team.</Text>
          <Button variant="secondary" size="sm" onClick={loadTeam}>
            Retry
          </Button>
        </Stack>
      </Card>
    );
  }

  const canRemoveMember = (member: TeamMember) => {
    if (!canManage) return false;
    if (callerRole === 'managers' && member.role === 'owners') return false;
    const owners = team.members.filter((m) => m.role === 'owners');
    if (member.role === 'owners' && owners.length <= 1) return false;
    return true;
  };

  return (
    <Stack gap={6}>
      <Stack gap={1}>
        <Link href="/teams" style={{ textDecoration: 'none' }}>
          <Text variant="caption" color="muted" style={{ cursor: 'pointer' }}>
            ← Teams
          </Text>
        </Link>
        <Text variant="h2">{team.name}</Text>
        <Text color="muted">
          {team.members.length} member{team.members.length !== 1 ? 's' : ''}
        </Text>
      </Stack>

      <Stack direction="row" gap={0}>
        <TabButton
          label="Members"
          active={activeTab === 'members'}
          onClick={() => navigate(`/teams/${id}`)}
        />
        {canManage && (
          <TabButton
            label="Invites"
            active={activeTab === 'invites'}
            onClick={() => navigate(`/teams/${id}?tab=invites`)}
          />
        )}
      </Stack>

      <Divider />

      {activeTab === 'members' ? (
        <Stack gap={3}>
          {team.members.map((member) => (
            <MemberRow
              key={member.subjectId}
              {...member}
              canRemove={canRemoveMember(member)}
              onRemove={() => setConfirmRemove(member)}
            />
          ))}
        </Stack>
      ) : (
        <Stack gap={4}>
          <Stack direction="row" justify="space-between" align="center">
            <Text variant="h4">Invites ({invites.length})</Text>
            <Button size="sm" onClick={() => setShowCreateInvite(true)}>
              Create invite
            </Button>
          </Stack>
          {invites.length === 0 ? (
            <Text color="muted">No active invites.</Text>
          ) : (
            <Stack gap={3}>
              {invites.map((inv) => (
                <InviteCard
                  key={inv.id}
                  {...inv}
                  onDelete={(invId) => setConfirmDeleteInvite(invId)}
                />
              ))}
            </Stack>
          )}
        </Stack>
      )}

      <CreateInviteDialog
        open={showCreateInvite}
        onClose={() => setShowCreateInvite(false)}
        teamId={id}
        onCreated={() => void loadInvites()}
      />

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Remove member"
        message={`Remove ${confirmRemove?.displayName ?? 'this member'} from the team?`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (confirmRemove) void handleRemoveMember(confirmRemove);
        }}
        onCancel={() => setConfirmRemove(null)}
      />

      <ConfirmDialog
        open={confirmDeleteInvite !== null}
        title="Delete invite"
        message="This invite code will stop working immediately."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (confirmDeleteInvite) void handleDeleteInvite(confirmDeleteInvite);
        }}
        onCancel={() => setConfirmDeleteInvite(null)}
      />
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
        background: 'none',
        border: 'none',
        borderBottom: `2px solid ${
          active ? theme.color.primary.DEFAULT : 'transparent'
        }`,
        padding: `${theme.spacing[2]} ${theme.spacing[4]}`,
        color: active ? theme.color.text.DEFAULT : theme.color.text.muted,
        fontFamily: 'inherit',
        fontSize: theme.font.size.sm,
        fontWeight: active
          ? theme.font.weight.semibold
          : theme.font.weight.normal,
        cursor: 'pointer',
        transition: theme.transition.fast,
      }}
    >
      {label}
    </button>
  );
}
