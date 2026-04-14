import {
  deleteGroup,
  deleteTeamInvite,
  type DiaryCatalog,
  getTeam,
  type GetTeamResponses,
  listDiaries,
  listGroups,
  type ListGroupsResponses,
  listTeamInvites,
  type ListTeamInvitesResponses,
  removeTeamMember,
} from '@moltnet/api-client';
import {
  Button,
  Card,
  ConfirmDialog,
  Divider,
  Input,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';

import { getApiClient } from '../api.js';
import { CreateGroupDialog } from '../components/teams/CreateGroupDialog.js';
import { CreateInviteDialog } from '../components/teams/CreateInviteDialog.js';
import {
  GrantDiaryAccessDialog,
  type GrantTarget,
} from '../components/teams/GrantDiaryAccessDialog.js';
import { GroupCard } from '../components/teams/GroupCard.js';
import { InviteCard } from '../components/teams/InviteCard.js';
import { MemberRow } from '../components/teams/MemberRow.js';
import { TeamDiaryCard } from '../components/teams/TeamDiaryCard.js';
import { useTeam } from '../team/useTeam.js';

type TeamDetail = GetTeamResponses[200];
type TeamMember = TeamDetail['members'][number];
type TeamInvite = ListTeamInvitesResponses[200]['items'][number];
type TeamGroup = ListGroupsResponses[200]['items'][number];

type Tab = 'members' | 'invites' | 'groups' | 'diaries';

export function TeamDetailPage({ id }: { id: string }) {
  const { teams } = useTeam();
  const [, navigate] = useLocation();
  const search = useSearch();
  const theme = useTheme();
  const params = new URLSearchParams(search);

  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [groups, setGroups] = useState<TeamGroup[]>([]);
  const [diaries, setDiaries] = useState<DiaryCatalog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [memberQuery, setMemberQuery] = useState('');

  const [showCreateInvite, setShowCreateInvite] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [grantDialogDiary, setGrantDialogDiary] = useState<DiaryCatalog | null>(
    null,
  );
  const [grantsRefresh, setGrantsRefresh] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState<TeamMember | null>(null);
  const [confirmDeleteInvite, setConfirmDeleteInvite] = useState<string | null>(
    null,
  );
  const [confirmDeleteGroup, setConfirmDeleteGroup] =
    useState<TeamGroup | null>(null);

  const callerTeam = teams.find((t) => t.id === id);
  const callerRole = callerTeam?.role ?? 'member';
  const canManage = callerRole === 'owners' || callerRole === 'managers';

  // Personal teams don't host groups or invites — exclude from allowed tabs so
  // direct links like `?tab=groups` on a personal team fall back to 'members'.
  const isPersonal = team?.personal === true;
  const requestedTab = params.get('tab') as Tab | null;
  const allowedTabs: Tab[] = isPersonal
    ? ['members', 'diaries']
    : canManage
      ? ['members', 'invites', 'groups', 'diaries']
      : ['members', 'groups', 'diaries'];
  const activeTab: Tab =
    requestedTab && allowedTabs.includes(requestedTab)
      ? requestedTab
      : 'members';

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
      if (data) setInvites(data.items);
    } catch {
      // Non-critical
    }
  }, [id, canManage]);

  const loadGroups = useCallback(async () => {
    try {
      const { data } = await listGroups({
        client: getApiClient(),
        path: { id },
      });
      if (data) setGroups(data.items);
    } catch {
      // Non-critical
    }
  }, [id]);

  const loadDiaries = useCallback(async () => {
    try {
      const { data } = await listDiaries({
        client: getApiClient(),
        headers: { 'x-moltnet-team-id': id },
      });
      if (data) setDiaries(data.items);
    } catch {
      // Non-critical
    }
  }, [id]);

  useEffect(() => {
    void loadTeam();
    void loadInvites();
    void loadGroups();
    void loadDiaries();
  }, [loadTeam, loadInvites, loadGroups, loadDiaries]);

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

  const handleDeleteGroup = async (group: TeamGroup) => {
    setActionError(null);
    try {
      await deleteGroup({
        client: getApiClient(),
        path: { groupId: group.id },
      });
      void loadGroups();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to delete group',
      );
    }
    setConfirmDeleteGroup(null);
  };

  const filteredMembers = useMemo(() => {
    if (!team) return [];
    const q = memberQuery.trim().toLowerCase();
    if (!q) return team.members;
    return team.members.filter((m) =>
      [m.displayName, m.email ?? '', m.fingerprint ?? '', m.subjectId].some(
        (v) => v.toLowerCase().includes(q),
      ),
    );
  }, [team, memberQuery]);

  const resolveSubject = useCallback(
    (subjectId: string, subjectNs: 'Agent' | 'Human' | 'Group') => {
      if (subjectNs === 'Group') {
        const grp = groups.find((g) => g.id === subjectId);
        return {
          id: subjectId,
          type: subjectNs,
          label: grp?.name ?? subjectId.slice(0, 8),
        };
      }
      const member = team?.members.find((m) => m.subjectId === subjectId);
      return {
        id: subjectId,
        type: subjectNs,
        label: member?.displayName ?? subjectId.slice(0, 8),
        fingerprint: member?.fingerprint,
      };
    },
    [groups, team],
  );

  const grantCandidates = useMemo((): GrantTarget[] => {
    const targets: GrantTarget[] = [];
    if (team) {
      for (const m of team.members) {
        targets.push({
          id: m.subjectId,
          type: m.subjectType === 'human' ? 'Human' : 'Agent',
          label: m.displayName,
        });
      }
    }
    for (const g of groups) {
      targets.push({ id: g.id, type: 'Group', label: g.name });
    }
    return targets;
  }, [team, groups]);

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
        {!isPersonal && (
          <TabButton
            label="Groups"
            active={activeTab === 'groups'}
            onClick={() => navigate(`/teams/${id}?tab=groups`)}
          />
        )}
        <TabButton
          label="Diaries"
          active={activeTab === 'diaries'}
          onClick={() => navigate(`/teams/${id}?tab=diaries`)}
        />
        {canManage && !isPersonal && (
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

      {activeTab === 'members' && (
        <Stack gap={4}>
          {team.members.length > 5 && (
            <Input
              placeholder="Search members by name, email, or fingerprint"
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              inputSize="sm"
            />
          )}
          {filteredMembers.length === 0 ? (
            <Text color="muted">No members match your search.</Text>
          ) : (
            <Stack gap={3}>
              {filteredMembers.map((member) => (
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
          )}
        </Stack>
      )}

      {activeTab === 'groups' && (
        <Stack gap={4}>
          <Stack direction="row" justify="space-between" align="center">
            <Text variant="h4">Groups ({groups.length})</Text>
            {canManage && (
              <Button size="sm" onClick={() => setShowCreateGroup(true)}>
                Create group
              </Button>
            )}
          </Stack>
          {groups.length === 0 ? (
            <Text color="muted">
              No groups yet. Groups let you bundle members for diary grants.
            </Text>
          ) : (
            <Stack gap={3}>
              {groups.map((g) => (
                <GroupCard
                  key={g.id}
                  id={g.id}
                  name={g.name}
                  canDelete={canManage}
                  onDelete={() => setConfirmDeleteGroup(g)}
                />
              ))}
            </Stack>
          )}
        </Stack>
      )}

      {activeTab === 'diaries' && (
        <Stack gap={4}>
          <Text variant="h4">Diaries ({diaries.length})</Text>
          {diaries.length === 0 ? (
            <Text color="muted">No diaries scoped to this team yet.</Text>
          ) : (
            <Stack gap={3}>
              {diaries.map((d) => (
                <TeamDiaryCard
                  key={d.id}
                  diary={d}
                  resolveSubject={resolveSubject}
                  canManage={canManage}
                  onGrantClick={(diary) => setGrantDialogDiary(diary)}
                  refreshKey={grantsRefresh}
                />
              ))}
            </Stack>
          )}
        </Stack>
      )}

      {activeTab === 'invites' && canManage && !isPersonal && (
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

      <CreateGroupDialog
        open={showCreateGroup}
        onClose={() => setShowCreateGroup(false)}
        teamId={id}
        onCreated={(groupId) => {
          setShowCreateGroup(false);
          void loadGroups().then(() => navigate(`/groups/${groupId}`));
        }}
      />

      {grantDialogDiary && (
        <GrantDiaryAccessDialog
          open={grantDialogDiary !== null}
          onClose={() => setGrantDialogDiary(null)}
          diaryId={grantDialogDiary.id}
          diaryName={grantDialogDiary.name}
          candidates={grantCandidates}
          onGranted={() => setGrantsRefresh((v) => v + 1)}
        />
      )}

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

      <ConfirmDialog
        open={confirmDeleteGroup !== null}
        title="Delete group"
        message={`Delete group "${confirmDeleteGroup?.name ?? ''}"? Diary grants targeting this group will stop applying.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (confirmDeleteGroup) void handleDeleteGroup(confirmDeleteGroup);
        }}
        onCancel={() => setConfirmDeleteGroup(null)}
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
