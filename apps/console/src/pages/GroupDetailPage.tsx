import {
  getGroup,
  type GetGroupResponses,
  getTeam,
  type GetTeamResponses,
  removeGroupMember,
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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';

import { getApiClient } from '../api.js';
import {
  type AddGroupMemberCandidate,
  AddGroupMemberDialog,
} from '../components/teams/AddGroupMemberDialog.js';
import { MemberRow } from '../components/teams/MemberRow.js';
import { useTeam } from '../team/useTeam.js';

type Group = GetGroupResponses[200];
type TeamDetail = GetTeamResponses[200];
type TeamMember = TeamDetail['members'][number];
type GroupMember = Group['members'][number];

export function GroupDetailPage({ groupId }: { groupId: string }) {
  const { teams } = useTeam();
  const theme = useTheme();

  const [group, setGroup] = useState<Group | null>(null);
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<GroupMember | null>(null);

  const callerTeam = group ? teams.find((t) => t.id === group.teamId) : null;
  const callerRole = callerTeam?.role ?? 'member';
  const canManage = callerRole === 'owners' || callerRole === 'managers';

  const loadGroup = useCallback(async () => {
    setError(null);
    try {
      const { data } = await getGroup({
        client: getApiClient(),
        path: { groupId },
      });
      if (data) setGroup(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load group'));
    }
  }, [groupId]);

  // Team enrichment is best-effort: if it fails, we still render the group
  // with fallback labels derived from group members.
  const loadTeam = useCallback(async (teamId: string) => {
    try {
      const { data } = await getTeam({
        client: getApiClient(),
        path: { id: teamId },
      });
      if (data) setTeam(data);
    } catch {
      // Swallow — group detail remains usable without team enrichment
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      await loadGroup();
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadGroup]);

  // Fetch the team once we know which team the group belongs to. Only re-runs
  // when the teamId itself changes, not on every group refresh.
  useEffect(() => {
    if (group?.teamId) void loadTeam(group.teamId);
  }, [group?.teamId, loadTeam]);

  const enrichedMembers = useMemo(() => {
    if (!group) return [];
    const byId = team
      ? new Map<string, TeamMember>(team.members.map((m) => [m.subjectId, m]))
      : new Map<string, TeamMember>();
    return group.members.map((gm) => {
      const teamMember = byId.get(gm.subjectId);
      return {
        subjectId: gm.subjectId,
        subjectType:
          teamMember?.subjectType ??
          (gm.subjectNs === 'Human' ? 'human' : 'agent'),
        displayName: teamMember?.displayName ?? gm.subjectId.slice(0, 8),
        fingerprint: teamMember?.fingerprint,
        email: teamMember?.email,
      };
    });
  }, [group, team]);

  const candidates = useMemo<AddGroupMemberCandidate[]>(() => {
    if (!group || !team) return [];
    const inGroup = new Set(group.members.map((m) => m.subjectId));
    return team.members
      .filter((m) => !inGroup.has(m.subjectId))
      .map((m) => ({
        subjectId: m.subjectId,
        subjectType: m.subjectType,
        displayName: m.displayName,
        fingerprint: m.fingerprint,
        email: m.email,
      }));
  }, [group, team]);

  const handleRemove = async (member: GroupMember) => {
    setActionError(null);
    try {
      await removeGroupMember({
        client: getApiClient(),
        path: { groupId, subjectId: member.subjectId },
      });
      void loadGroup();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to remove member',
      );
    }
    setConfirmRemove(null);
  };

  if (isLoading) return <Text color="muted">Loading...</Text>;
  if (error || !group) {
    return (
      <Card padding="md">
        <Stack gap={3}>
          <Text color="muted">Failed to load group.</Text>
          <Button variant="secondary" size="sm" onClick={loadGroup}>
            Retry
          </Button>
        </Stack>
      </Card>
    );
  }

  return (
    <Stack gap={6}>
      <Stack gap={1}>
        <Link
          href={`/teams/${group.teamId}?tab=groups`}
          style={{ textDecoration: 'none' }}
        >
          <Text variant="caption" color="muted" style={{ cursor: 'pointer' }}>
            ← {team?.name ?? 'Team'} / Groups
          </Text>
        </Link>
        <Text variant="h2">{group.name}</Text>
        <Text color="muted">
          {group.members.length} member
          {group.members.length === 1 ? '' : 's'}
        </Text>
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

      <Stack gap={4}>
        <Stack direction="row" justify="space-between" align="center">
          <Text variant="h4">Members ({group.members.length})</Text>
          {canManage && (
            <Button size="sm" onClick={() => setShowAdd(true)}>
              Add member
            </Button>
          )}
        </Stack>
        {enrichedMembers.length === 0 ? (
          <Text color="muted">No members yet.</Text>
        ) : (
          <Stack gap={3}>
            {enrichedMembers.map((m) => (
              <MemberRow
                key={m.subjectId}
                subjectId={m.subjectId}
                subjectType={m.subjectType}
                displayName={m.displayName}
                fingerprint={m.fingerprint}
                email={m.email}
                canRemove={canManage}
                onRemove={() =>
                  setConfirmRemove(
                    group.members.find((gm) => gm.subjectId === m.subjectId) ??
                      null,
                  )
                }
              />
            ))}
          </Stack>
        )}
      </Stack>

      <AddGroupMemberDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        groupId={groupId}
        candidates={candidates}
        onAdded={() => void loadGroup()}
      />

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Remove from group"
        message="Remove this member from the group? They remain in the team."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (confirmRemove) void handleRemove(confirmRemove);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </Stack>
  );
}
