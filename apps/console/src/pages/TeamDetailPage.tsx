import {
  deleteTeamInvite,
  getTeam,
  type GetTeamResponses,
  listTeamInvites,
  type ListTeamInvitesResponses,
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

type TeamDetail = GetTeamResponses[200];
type TeamMember = TeamDetail['members'][number];
type TeamInvite = ListTeamInvitesResponses[200]['items'][number];

export function TeamDetailPage({ id }: { id: string }) {
  const { teams } = useTeam();
  const [, navigate] = useLocation();
  const search = useSearch();
  const theme = useTheme();
  const params = new URLSearchParams(search);

  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showCreateInvite, setShowCreateInvite] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<TeamMember | null>(null);
  const [confirmDeleteInvite, setConfirmDeleteInvite] = useState<string | null>(
    null,
  );

  const callerTeam = teams.find((t) => t.id === id);
  const callerRole = callerTeam?.role ?? 'member';
  const canManage = callerRole === 'owners' || callerRole === 'managers';

  const requestedTab = params.get('tab');
  const activeTab: 'members' | 'invites' =
    requestedTab === 'invites' && canManage ? 'invites' : 'members';

  const loadTeam = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data } = await getTeam({
        client: getApiClient(),
        path: { id },
      });
      if (data) {
        setTeam(data);
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
        setInvites(data.items);
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
    setActionError(null);
    try {
      await removeTeamMember({
        client: getApiClient(),
        path: { id, subjectId: member.subjectId },
      });
      void loadTeam();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to remove member',
      );
    }
    setConfirmRemove(null);
  };

  const handleDeleteInvite = async (inviteId: string) => {
    setActionError(null);
    try {
      await deleteTeamInvite({
        client: getApiClient(),
        path: { id, inviteId },
      });
      void loadInvites();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to delete invite',
      );
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

      {actionError && (
        <Card
          variant="outlined"
          padding="sm"
          style={{ borderColor: theme.color.error.DEFAULT }}
        >
          <Stack direction="row" gap={2} justify="space-between" align="center">
            <Text
              variant="caption"
              style={{ color: theme.color.error.DEFAULT }}
            >
              {actionError}
            </Text>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActionError(null)}
            >
              Dismiss
            </Button>
          </Stack>
        </Card>
      )}

      {activeTab === 'members' ? (
        <Stack gap={3}>
          {team.members.map((member) => (
            <MemberRow
              key={member.subjectId}
              subjectId={member.subjectId}
              subjectType={member.subjectType}
              role={member.role}
              displayName={member.displayName}
              fingerprint={member.fingerprint}
              email={member.email}
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
                  id={inv.id}
                  code={inv.code}
                  role={inv.role ?? 'member'}
                  maxUses={inv.maxUses}
                  useCount={inv.useCount ?? 0}
                  expiresAt={inv.expiresAt}
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
